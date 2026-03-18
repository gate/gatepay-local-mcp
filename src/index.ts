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
 *   quick_wallet with no local token: use tool arg wallet_login_provider (google | gate) for OAuth
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

import { X402ClientStandalone } from "./x402-standalone/client.js";
import { ExactEvmScheme } from "./x402-standalone/exactEvmScheme.js";
import {createSignerFromMcpWallet, createSignerFromPrivateKey} from "./x402-standalone/signer.js";
import { wrapFetchWithPayment } from "./x402-standalone/fetch.js";
import {getMcpClient, loadAuth, loginWithDeviceFlow} from "./x402-standalone";

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
      description:
          'JSON string request body for POST/PUT/PATCH. Omit for GET.',
    },
    auth_mode: {
      type: "string",
      description:
          "Optional. quick_wallet: custodial MCP wallet. Omit: sign with EVM_PRIVATE_KEY.",
      enum: ["quick_wallet"],
    },
    wallet_login_provider: {
      type: "string",
      description:
          "When auth_mode is quick_wallet and login is required (no saved token): OAuth provider. google = Google account, gate = Gate account. User picks in chat; model passes their choice. Defaults to gate if omitted.",
      enum: ["google", "gate"],
    },
  },
  required: ["url"],
};

const TOOL_DESCRIPTION =
    "Execute a single HTTP request with automatic x402 payment on 402. Use ONLY for endpoints that require payment (402). " +
    "For quick_wallet first-time login, set wallet_login_provider to google or gate according to what the user chose in chat. " +
    "Pass full url and JSON body string as documented in the Skill.";

async function main(): Promise<void> {

  const mcpWalletUrl = process.env.MCP_WALLET_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const mcpApiKey = process.env.MCP_WALLET_API_KEY;

  /** Local private key mode: reuse same client + wrapFetch after first success */
  let cachedLocalPayFetch: typeof fetch | undefined;

  function getOrCreateLocalPayFetch(): typeof fetch {
    if (cachedLocalPayFetch) return cachedLocalPayFetch;
    const raw = process.env.EVM_PRIVATE_KEY?.trim();
    if (!raw) {
      throw new Error(
          "EVM_PRIVATE_KEY is not set. Configure it for default signing, or use auth_mode quick_wallet for custodial MCP.",
      );
    }
    const evmPrivateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    const signer = createSignerFromPrivateKey(evmPrivateKey);
    const c = new X402ClientStandalone();
    c.register("gatelayer_testnet", new ExactEvmScheme(signer));
    c.register("eth", new ExactEvmScheme(signer));
    c.register("base", new ExactEvmScheme(signer));
    c.register("Polygon", new ExactEvmScheme(signer));
    c.register("gatelayer", new ExactEvmScheme(signer));
    c.register("gatechain", new ExactEvmScheme(signer));
    c.register("Arbitrum One", new ExactEvmScheme(signer));
    cachedLocalPayFetch = wrapFetchWithPayment(fetch, c);
    return cachedLocalPayFetch;
  }

  /** quick_wallet: reuse after first success; concurrent callers share one init promise; failures are not cached so retry works */
  let cachedQuickWalletPayFetch: typeof fetch | undefined;
  let quickWalletInitPromise: Promise<typeof fetch> | undefined;

  async function getOrCreateQuickWalletPayFetch(
      walletLoginProvider: "google" | "gate",
  ): Promise<typeof fetch> {
    if (cachedQuickWalletPayFetch) return cachedQuickWalletPayFetch;
    while (quickWalletInitPromise) {
      await quickWalletInitPromise;
      if (cachedQuickWalletPayFetch) return cachedQuickWalletPayFetch;
    }
    const isGoogle = walletLoginProvider === "google";
    const providerLabel = isGoogle ? "Google" : "Gate";
    quickWalletInitPromise = (async () => {
      const mcp = await getMcpClient({ serverUrl: mcpWalletUrl, apiKey: mcpApiKey });
      const savedAuth = loadAuth();
      if (savedAuth?.mcp_token) {
        mcp.setMcpToken(savedAuth.mcp_token);
      } else {
        console.error(
            `[x402_request] quick_wallet: no saved token, starting ${providerLabel} device-flow login…`,
        );
        const loginOk = await loginWithDeviceFlow(mcp, mcpWalletUrl, isGoogle, providerLabel, {
          saveToken: true,
          reportAddresses: false,
        });
        if (!loginOk) {
          throw new Error("quick_wallet login did not complete (cancelled, failed, or timed out)");
        }
      }
      const signer = await createSignerFromMcpWallet(mcp);
      const c = new X402ClientStandalone();
      c.register("gatelayer_testnet", new ExactEvmScheme(signer));
      c.register("eth", new ExactEvmScheme(signer));
      c.register("base", new ExactEvmScheme(signer));
      c.register("Polygon", new ExactEvmScheme(signer));
      c.register("gatelayer", new ExactEvmScheme(signer));
      c.register("gatechain", new ExactEvmScheme(signer));
      c.register("Arbitrum One", new ExactEvmScheme(signer));
      const wrapped = wrapFetchWithPayment(fetch, c);
      cachedQuickWalletPayFetch = wrapped;
      return wrapped;
    })().finally(() => {
      quickWalletInitPromise = undefined;
    });
    return quickWalletInitPromise;
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
    const walletLoginRaw =
        params.wallet_login_provider != null
            ? String(params.wallet_login_provider).trim().toLowerCase()
            : "";
    const walletLoginProvider: "google" | "gate" =
        walletLoginRaw === "google" ? "google" : "gate";

    let payFetch: typeof fetch;
    try {
      payFetch =
          authMode === "quick_wallet"
              ? await getOrCreateQuickWalletPayFetch(walletLoginProvider)
              : getOrCreateLocalPayFetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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

      const response = await payFetch(url, init);
      const responseText = await response.text();

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
