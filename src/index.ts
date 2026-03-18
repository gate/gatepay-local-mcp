#!/usr/bin/env node
/**
 * x402 stdio bridge — standalone, no @x402/* dependencies.
 *
 * All x402 logic is inlined under x402-standalone/ so this package
 * can be published and run via `npx -y gatepay-local-mcp` without
 * depending on unpublished @x402/core, @x402/evm, @x402/fetch.
 *
 * One MCP tool: x402_request
 *   - url: full URL (required)
 *   - method: GET | POST | PUT | PATCH (default POST)
 *   - body: JSON string for request body (POST/PUT/PATCH); omit for GET
 *
 * Env:
 *   EVM_PRIVATE_KEY — required for default x402_request (local EVM signing)
 *   MCP_WALLET_URL / MCP_WALLET_API_KEY — for auth_mode quick_wallet (custodial MCP)
 *   X402_DEBUG_LOG — optional debug log file path
 */
import { config } from "dotenv";
import { createWriteStream, existsSync } from "node:fs";
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
  createSignerFromMcpWallet,
  createSignerFromPrivateKey,
  getMcpClient,
  loadAuth,
  loginWithDeviceFlow,
  wrapFetchWithPayment,
} from "./x402-standalone/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return startDir;
    dir = parent;
  }
}

const packageRoot = findPackageRoot(__dirname);
config({ path: join(packageRoot, ".env") });

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
    auth_mode: {
      type: "string",
      description:
          "Optional. quick_wallet: custodial MCP wallet (Gate device-flow if no saved token). Omit: sign with EVM_PRIVATE_KEY (local private key).",
      enum: ["quick_wallet"],
    },
  },
  required: ["url"],
};

const TOOL_DESCRIPTION =
    "Execute a single HTTP request with automatic x402 payment on 402. Use ONLY for endpoints that require payment (402). " +
    "Pass full url and JSON body string as documented in the Skill. Do not use for plain/public list endpoints.";

async function main(): Promise<void> {
  const mcpWalletUrl = process.env.MCP_WALLET_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const mcpApiKey = process.env.MCP_WALLET_API_KEY;

  function fetchWithLocalPrivateKey(): typeof fetch {
    const raw = process.env.EVM_PRIVATE_KEY?.trim();
    if (!raw) {
      throw new Error(
          "EVM_PRIVATE_KEY is not set. Configure it for default signing, or use auth_mode quick_wallet for custodial MCP.",
      );
    }
    const evmPrivateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    const signer = createSignerFromPrivateKey(evmPrivateKey);
    const c = new X402ClientStandalone();
    c.register("eth", new ExactEvmScheme(signer));
    c.register("base", new ExactEvmScheme(signer));
    return wrapFetchWithPayment(fetch, c);
  }

  async function fetchWithQuickWalletAuth(): Promise<typeof fetch> {
    const mcp = await getMcpClient({ serverUrl: mcpWalletUrl, apiKey: mcpApiKey });
    const savedAuth = loadAuth();
    if (savedAuth?.mcp_token) {
      mcp.setMcpToken(savedAuth.mcp_token);
    } else {
      console.error("[x402_request] quick_wallet: no saved token, starting Gate device-flow login…");
      const loginOk = await loginWithDeviceFlow(mcp, mcpWalletUrl, false, "Gate", {
        saveToken: true,
        reportAddresses: false,
      });
      if (!loginOk) {
        throw new Error("quick_wallet login did not complete (cancelled, failed, or timed out)");
      }
    }
    const signer = await createSignerFromMcpWallet(mcp);
    const c = new X402ClientStandalone();
    c.register("eth", new ExactEvmScheme(signer));
    c.register("base", new ExactEvmScheme(signer));
    return wrapFetchWithPayment(fetch, c);
  }

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
    const authMode =
        params.auth_mode != null ? String(params.auth_mode).trim() : "";

    let payFetch: typeof fetch;
    try {
      payFetch =
          authMode === "quick_wallet"
              ? await fetchWithQuickWalletAuth()
              : fetchWithLocalPrivateKey();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      debugLog("pay fetch build failed", {
        authMode: authMode || "local_private_key",
        error: msg,
      });
      return {
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }

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

      debugLog("fetch start", { url, method, authMode: authMode || "default" });
      const response = await payFetch(url, init);
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
              ? " 请确认 url 可访问；402 支付需托管钱包已登录且有足够余额。"
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
