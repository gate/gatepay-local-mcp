#!/usr/bin/env node
/**
 * x402 stdio bridge — standalone, no @x402/* dependencies.
 *
 * All x402 logic is inlined under andes/x402-standalone/ so this package
 * can be published and run via `npx -y @andesmountain/x402-request` without
 * depending on unpublished @x402/core, @x402/evm, @x402/fetch.
 *
 * One MCP tool: x402_request
 *   - url: full URL (required)
 *   - method: GET | POST | PUT | PATCH (default POST)
 *   - body: JSON string for request body (POST/PUT/PATCH); omit for GET
 *
 * Env:
 *   EVM_PRIVATE_KEY (required; when run via npx, pass via MCP "env" config)
 *   X402_DEBUG_LOG  (optional) path to file — when set, append debug logs here (tail -f to debug)
 */
import { config } from "dotenv";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  X402ClientStandalone,
  ExactEvmScheme,
  createSignerFromPrivateKey,
  wrapFetchWithPayment,
} from "./x402-standalone/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, ".env") });

const LOG_PATH = process.env.X402_DEBUG_LOG ?? process.env.MCP_X402_DEBUG_LOG;
const logStream = LOG_PATH
  ? (() => {
    try {
      return createWriteStream(LOG_PATH, { flags: "a" });
    } catch (e) {
      console.error("X402 debug log open failed:", e);
      return null;
    }
  })()
  : null;

function debugLog(msg: string, obj?: unknown): void {
  if (!logStream) return;
  const line = `${new Date().toISOString()} ${msg}${obj != null ? " " + JSON.stringify(obj) : ""}\n`;
  logStream.write(line);
}

const TOOL_NAME = "x402_request";

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description:
        "Full URL of the x402-protected endpoint. Must be included in Skill; do not guess.",
    },
    method: {
      type: "string",
      description: "HTTP method: GET, POST, PUT, or PATCH. Default POST.",
    },
    body: {
      type: "string",
      description:
        'JSON string request body for POST/PUT/PATCH. Omit for GET.',
    },
  },
  required: ["url"],
};

const TOOL_DESCRIPTION =
  "Execute a single HTTP request with automatic x402 payment on 402. Use ONLY for endpoints that require payment (402). " +
  "Pass full url and JSON body string as documented in the Skill. Do not use for plain/public list endpoints.";

async function main(): Promise<void> {
  debugLog("x402-request bridge starting");
  const rawEvmKey = process.env.EVM_PRIVATE_KEY?.trim();
  if (!rawEvmKey) {
    debugLog("startup failed: EVM_PRIVATE_KEY missing");
    console.error("❌ EVM_PRIVATE_KEY is required (wallet private key for x402 payment)");
    process.exit(1);
  }
  const evmPrivateKey = (rawEvmKey.startsWith("0x") ? rawEvmKey : `0x${rawEvmKey}`) as `0x${string}`;

  const evmSigner = createSignerFromPrivateKey(evmPrivateKey);
  const client = new X402ClientStandalone();
  client.register("gatelayer_testnet", new ExactEvmScheme(evmSigner));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const server = new Server({
    name: "x402 Paid Request Bridge (standalone)",
    version: "1.0.0",
  });
  server.registerCapabilities({ tools: { listChanged: false } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    debugLog("tool call", { name, args });
    if (name !== TOOL_NAME) {
      return {
        content: [{ type: "text" as const, text: `未知工具: ${name}. 仅支持 ${TOOL_NAME}。` }],
        isError: true,
      };
    }

    const params = (args ?? {}) as Record<string, unknown>;
    const url = String(params.url ?? "").trim();
    if (!url || !url.startsWith("http")) {
      return {
        content: [{ type: "text" as const, text: "缺少或无效参数 url（需完整 http/https URL）。" }],
        isError: true,
      };
    }

    const method = String(params.method ?? "POST").trim().toUpperCase() || "POST";
    const bodyStr = params.body != null ? String(params.body) : "";

    try {
      let init: RequestInit;
      if (method === "GET") {
        init = { method: "GET" };
      } else if (method === "POST" || method === "PUT" || method === "PATCH") {
        if (bodyStr && bodyStr.trim()) {
          try {
            JSON.parse(bodyStr);
          } catch {
            return {
              content: [{ type: "text" as const, text: "body 必须是合法 JSON 字符串。" }],
              isError: true,
            };
          }
        }
        init = {
          method,
          headers: { "Content-Type": "application/json" },
          body: bodyStr && bodyStr.trim() ? bodyStr : undefined,
        };
      } else {
        return {
          content: [{ type: "text" as const, text: `不支持的 method: ${method}` }],
          isError: true,
        };
      }

      debugLog("fetch start", { url, method });
      const response = await fetchWithPayment(url, init);
      const responseText = await response.text();
      debugLog("fetch done", { url, status: response.status, textLen: responseText.length });

      let text: string;
      try {
        const json = JSON.parse(responseText) as { data?: unknown };
        text = json.data != null ? JSON.stringify(json.data, null, 2) : JSON.stringify(json, null, 2);
      } catch {
        text = responseText;
      }

      if (!response.ok && response.status !== 402) {
        return {
          content: [{ type: "text" as const, text: `HTTP ${response.status}: ${text}` }],
          isError: true,
        };
      }

      return { content: [{ type: "text" as const, text }], isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugLog("request error", { url, method, error: message, stack: err instanceof Error ? err.stack : undefined });
      const hint =
        message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")
          ? " 请确认 url 可访问；402 支付需 EVM_PRIVATE_KEY 对应钱包有足够余额。"
          : "";
      return {
        content: [{ type: "text" as const, text: `请求失败: ${message}.${hint}` }],
        isError: true,
      };
    }
  });

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

main().catch((err) => {
  debugLog("fatal", { error: String(err), stack: err instanceof Error ? err.stack : undefined });
  console.error("Fatal error:", err);
  process.exit(1);
});
