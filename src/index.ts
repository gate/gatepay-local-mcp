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
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { normalizeX402RequestInput } from "./modes/input-normalizer.js";
import { LocalPrivateKeyMode } from "./modes/local-private-key.js";
import { PluginWalletMode } from "./modes/plugin-wallet.js";
import {
  createSignModeRegistry,
  formatSignModeSelectionError,
} from "./modes/registry.js";
import { QuickWalletMode } from "./modes/quick-wallet.js";
import { getMcpClientSync } from "./wallets/wallet-mcp-clients.js";

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
const INSUFFICIENT_BALANCE_CODE = "800001001";

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
        "Optional preferred signing mode. Omit to auto-select the highest-priority ready mode. " +
        "If the initial payment fails, ask the user which payment method to use instead of automatically retrying.",
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
  "Set sign_mode to choose a signing mode, or omit it to auto-select the highest-priority ready mode. " +
  "IMPORTANT: If a payment fails, do NOT automatically retry with a different sign_mode. Instead, ask the user which payment method they would like to try.";

function parsePossiblyNestedJson(text: string): unknown {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function containsInsufficientBalanceSignal(message: string): boolean {
  return message.toLowerCase().includes("insufficient balance");
}

async function buildInsufficientBalanceReply(baseMessage: string): Promise<string> {
  const mcp = getMcpClientSync();
  if (!mcp || !mcp.isAuthenticated()) {
    return [
      "支付失败：检测到余额不足。",
      `原始信息: ${baseMessage}`,
      "当前无法获取钱包余额（未检测到已登录的托管钱包会话）。",
    ].join("\n");
  }

  try {
    const tokenListResult = await mcp.walletGetTokenList();
    const content = (tokenListResult as { content?: unknown[] }).content;
    const first = Array.isArray(content)
      ? (content[0] as { type?: string; text?: string } | undefined)
      : undefined;
    const balances =
      first?.type === "text" && typeof first.text === "string"
        ? parsePossiblyNestedJson(first.text) ?? first.text
        : tokenListResult;

    return JSON.stringify(
      {
        code: Number(INSUFFICIENT_BALANCE_CODE),
        message: "余额不足，已返回当前钱包余额信息",
        originalMessage: baseMessage,
        walletBalances: balances,
      },
      null,
      2,
    );
  } catch (error) {
    return [
      "支付失败：检测到余额不足。",
      `原始信息: ${baseMessage}`,
      `查询钱包余额失败: ${error instanceof Error ? error.message : String(error)}`,
    ].join("\n");
  }
}

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

function createErrorResponse(message: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function createSuccessResponse(text: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text }],
    isError: false,
  };
}

async function validateToolRequest(name: string, args: unknown): Promise<CallToolResult | null> {
  if (name !== TOOL_NAME) {
    return createErrorResponse(`未知工具: ${name}. 仅支持 ${TOOL_NAME}。`);
  }

  const normalized = normalizeX402RequestInput((args ?? {}) as Record<string, unknown>);
  if (!normalized.url || !normalized.url.startsWith("http")) {
    return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
  }

  return null;
}

function isCallToolResult(result: unknown): result is CallToolResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as CallToolResult).content)
  );
}

async function selectSignModeAndGetPayFetch(
  registry: ReturnType<typeof createSignModeRegistry>,
  signMode: string | undefined,
  walletLoginProvider: "google" | "gate"
): Promise<{ payFetch: typeof fetch } | CallToolResult> {
  try {
    const selectedMode = await registry.selectMode(signMode);
    const payFetch: typeof fetch = await registry.getOrCreatePayFetch(selectedMode.mode, {
      walletLoginProvider,
    });
    return { payFetch };
  } catch (error) {
    return createErrorResponse(formatSignModeSelectionError(error));
  }
}

function formatResponseText(responseText: string): string {
  try {
    const json = JSON.parse(responseText) as { data?: unknown };
    return json.data != null
      ? JSON.stringify(json.data, null, 2)
      : JSON.stringify(json, null, 2);
  } catch {
    return responseText;
  }
}

async function handleResponseWithBalanceCheck(
  response: Response,
  responseText: string
): Promise<CallToolResult> {
  const text = formatResponseText(responseText);
  const insufficientBalance =
    containsInsufficientBalanceSignal(responseText) ||
    containsInsufficientBalanceSignal(text);

  if (!response.ok && response.status !== 402) {
    if (insufficientBalance) {
      return createErrorResponse(await buildInsufficientBalanceReply(text));
    }
    return createErrorResponse(`HTTP ${response.status}: ${text}`);
  }

  if (insufficientBalance) {
    return createErrorResponse(await buildInsufficientBalanceReply(text));
  }

  return createSuccessResponse(text);
}

async function executeX402Request(
  payFetch: typeof fetch,
  normalized: ReturnType<typeof normalizeX402RequestInput>
): Promise<CallToolResult> {
  try {
    const init = buildRequestInit(normalized.method, normalized.body);
    const response = await payFetch(normalized.url, init);
    const responseText = await response.text();
    return await handleResponseWithBalanceCheck(response, responseText);
  } catch (error) {
    if (error instanceof Error && error.message.includes("不支持的 method")) {
      return createErrorResponse(error.message);
    }
    throw error;
  }
}

async function handleRequestError(err: unknown): Promise<CallToolResult> {
  const message = err instanceof Error ? err.message : String(err);
  if (containsInsufficientBalanceSignal(message)) {
    return createErrorResponse(await buildInsufficientBalanceReply(message));
  }
  const hint =
    message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")
      ? " 请确认 url 可访问；402 支付需托管钱包已登录且有足够余额。"
      : "";
  return createErrorResponse(`请求失败: ${message}.${hint}`);
}

async function main(): Promise<void> {
  const quickWalletMcpUrl = process.env.QUICK_WALLET_SERVER_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const quickWalletApiKey = process.env.QUICK_WALLET_API_KEY;
  
  const pluginWalletBaseUrl = process.env.PLUGIN_WALLET_SERVER_URL ?? "https://walletmcp-test.gateweb3.cc/mcp";
  const pluginWalletToken = process.env.PLUGIN_WALLET_TOKEN;
  const pluginWalletServerUrl = pluginWalletToken 
    ? `${pluginWalletBaseUrl}?token=${encodeURIComponent(pluginWalletToken)}`
    : undefined;

  const signModeRegistry = createSignModeRegistry([
    new LocalPrivateKeyMode(),
    new QuickWalletMode({ mcpWalletUrl: quickWalletMcpUrl, mcpApiKey: quickWalletApiKey }),
    new PluginWalletMode({ serverUrl: pluginWalletServerUrl }),
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

    const validationError = await validateToolRequest(name, args);
    if (validationError) {
      return validationError;
    }

    const normalized = normalizeX402RequestInput((args ?? {}) as Record<string, unknown>);

    const signModeResult = await selectSignModeAndGetPayFetch(
      signModeRegistry,
      normalized.signMode,
      normalized.walletLoginProvider
    );

    if (isCallToolResult(signModeResult)) {
      return signModeResult;
    }

    const payFetch = signModeResult.payFetch;

    try {
      const result = await executeX402Request(payFetch, normalized);
      return result;
    } catch (err) {
      return await handleRequestError(err);
    }
  });

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
