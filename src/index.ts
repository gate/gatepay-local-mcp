#!/usr/bin/env node
/**
 * x402 stdio bridge with pluggable sign_mode support.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { normalizeX402RequestInput } from "./sign-modes/input-normalizer.js";
import { LocalPrivateKeyMode } from "./sign-modes/local-private-key.js";
import { PluginWalletMode } from "./sign-modes/plugin-wallet.js";
import {
  createSignModeRegistry,
  formatSignModeSelectionError,
} from "./sign-modes/registry.js";
import { QuickWalletMode } from "./sign-modes/quick-wallet.js";

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
      description: "JSON string request body for POST/PUT/PATCH. Omit for GET.",
    },
    sign_mode: {
      type: "string",
      description:
        "Optional preferred signing mode. Omit to auto-select the highest-priority ready mode.",
      enum: ["local_private_key", "quick_wallet", "plugin_wallet"],
    },
    wallet_login_provider: {
      type: "string",
      description:
        "When quick_wallet needs login: OAuth provider. google = Google account, gate = Gate account. Defaults to gate.",
      enum: ["google", "gate"],
    },
  },
  required: ["url"],
};

const TOOL_DESCRIPTION =
  "Execute a single HTTP request with automatic x402 payment on 402. Use ONLY for endpoints that require payment (402). " +
  "Set sign_mode to choose a signing mode, or omit it to auto-select the highest-priority ready mode.";

function buildRequestInit(method: string, body?: string): RequestInit {
  if (method === "GET") {
    return { method: "GET" };
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    if (body && body.trim()) {
      JSON.parse(body);
    }

    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && body.trim() ? body : undefined,
    };
  }

  throw new Error(`不支持的 method: ${method}`);
}

async function main(): Promise<void> {
  const mcpWalletUrl = process.env.MCP_WALLET_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const mcpApiKey = process.env.MCP_WALLET_API_KEY;
  const signModeRegistry = createSignModeRegistry([
    new LocalPrivateKeyMode(),
    new QuickWalletMode({ mcpWalletUrl, mcpApiKey }),
    new PluginWalletMode(),
  ]);

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
    if (name !== TOOL_NAME) {
      return {
        content: [{ type: "text" as const, text: `未知工具: ${name}. 仅支持 ${TOOL_NAME}。` }],
        isError: true,
      };
    }

    const normalized = normalizeX402RequestInput((args ?? {}) as Record<string, unknown>);
    if (!normalized.url || !normalized.url.startsWith("http")) {
      return {
        content: [{ type: "text" as const, text: "缺少或无效参数 url（需完整 http/https URL）。" }],
        isError: true,
      };
    }

    let payFetch: typeof fetch;
    try {
      const selectedMode = await signModeRegistry.selectMode(normalized.signMode);
      payFetch = await signModeRegistry.getOrCreatePayFetch(selectedMode.mode, {
        walletLoginProvider: normalized.walletLoginProvider,
      });
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: formatSignModeSelectionError(error) }],
        isError: true,
      };
    }

    try {
      let init: RequestInit;
      try {
        init = buildRequestInit(normalized.method, normalized.body);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }

      const response = await payFetch(normalized.url, init);
      const responseText = await response.text();

      let text: string;
      try {
        const json = JSON.parse(responseText) as { data?: unknown };
        text =
          json.data != null
            ? JSON.stringify(json.data, null, 2)
            : JSON.stringify(json, null, 2);
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
  console.error("Fatal error:", err);
  process.exit(1);
});
