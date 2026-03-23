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
import type { PaymentRequired, PaymentPayload } from "./x402/types.js";
import { X402ClientStandalone } from "./x402/client.js";
import { ExactEvmScheme } from "./x402/exactEvmScheme.js";
import { 
  decodePaymentRequiredHeader, 
  encodePaymentSignatureHeader,
  getPaymentRequiredResponse
} from "./x402/http.js";
import { normalizePaymentRequirements } from "./x402/utils.js";

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

const SUPPORTED_NETWORKS = [
  "gatelayer_testnet",
  "eth",
  "base",
  "Polygon",
  "gatelayer",
  "gatechain",
  "Arbitrum One",
] as const;

// 保留原有工具的schema定义（虽然不再对外暴露，但保留用于向后兼容）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TOOL_DESCRIPTION =
  "Execute a single HTTP request with automatic x402 payment on 402. Use ONLY for endpoints that require payment (402). " +
  "Set sign_mode to choose a signing mode, or omit it to auto-select the highest-priority ready mode. " +
  "IMPORTANT: If a payment fails, do NOT automatically retry with a different sign_mode. Instead, ask the user which payment method they would like to try.";

// New tool schemas
const PLACE_ORDER_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "Full URL of the endpoint. Must be a complete http/https URL.",
    },
    method: {
      type: "string",
      description: "HTTP method: GET, POST, PUT, or PATCH. Default POST.",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "JSON string request body for POST/PUT/PATCH. Omit for GET.",
    },
  },
  required: ["url"],
};

const PLACE_ORDER_DESCRIPTION =
  "Send an HTTP request and return complete response information including headers, body, and the original request details. " +
  "Returns status code, all response headers (including PAYMENT-REQUIRED if present), response body, and the original request parameters. " +
  "Use this for any HTTP request where you need full response details.";

const SIGN_PAYMENT_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "Target URL for the payment request",
    },
    method: {
      type: "string",
      description: "HTTP method for the request",
      enum: ["GET", "POST", "PUT", "PATCH"],
    },
    body: {
      type: "string",
      description: "JSON string request body (optional)",
    },
    payment_required_header: {
      type: "string",
      description: "Base64-encoded PAYMENT-REQUIRED header value from a 402 response",
    },
    response_body: {
      type: "string",
      description: "Optional: Response body from 402 response, used for parsing payment requirements if PAYMENT-REQUIRED header is not available",
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

const SIGN_PAYMENT_DESCRIPTION =
  "Parse X402 payment requirements from PAYMENT-REQUIRED header or response body, create a signed payment authorization, " +
  "and submit the payment to complete a 402-protected request. " +
  "Supports three signing modes: local_private_key (local EVM wallet), quick_wallet (custodial MCP wallet), and plugin_wallet (browser extension wallet). " +
  "Provide either payment_required_header or response_body containing X402 payment requirements.";

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

async function handlePlaceOrder(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const normalized = normalizeX402RequestInput(args);
    
    if (!normalized.url || !normalized.url.startsWith("http")) {
      return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
    }

    const init = buildRequestInit(normalized.method, normalized.body);
    
    const response = await fetch(normalized.url, init);
    const responseText = await response.text();
    
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    const result = {
      request: {
        url: normalized.url,
        method: normalized.method,
        body: normalized.body || null,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: responseText,
      },
    };
    
    return createSuccessResponse(JSON.stringify(result, null, 2));
  } catch (err) {
    return await handleRequestError(err);
  }
}

async function handleSignPayment(
  args: Record<string, unknown>,
  signModeRegistry: ReturnType<typeof createSignModeRegistry>
): Promise<CallToolResult> {
  try {
    // 1. 解析参数
    const url = String(args.url ?? "").trim();
    const method = String(args.method ?? "POST").trim().toUpperCase();
    const body = args.body != null ? String(args.body) : "";
    const paymentRequiredHeader = args.payment_required_header != null ? String(args.payment_required_header).trim() : "";
    const responseBody = args.response_body != null ? String(args.response_body).trim() : "";
    const signMode = args.sign_mode != null ? String(args.sign_mode).trim() : undefined;
    const walletLoginProvider: "google" | "gate" = 
      String(args.wallet_login_provider ?? "gate").toLowerCase() === "google" ? "google" : "gate";
    
    if (!url || !url.startsWith("http")) {
      return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
    }
    
    // 2. 解析 PAYMENT-REQUIRED
    let paymentRequired: PaymentRequired;
    try {
      if (paymentRequiredHeader) {
        paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
      } else if (responseBody) {
        // 尝试从响应体解析
        const getHeader = () => null;
        let bodyObj: PaymentRequired | undefined;
        try {
          bodyObj = JSON.parse(responseBody) as PaymentRequired;
        } catch {
          return createErrorResponse("无法解析响应体为JSON，且未提供payment_required_header参数。");
        }
        paymentRequired = getPaymentRequiredResponse(getHeader, bodyObj);
      } else {
        return createErrorResponse("缺少payment_required_header或response_body参数，无法解析支付要求。");
      }
      
      paymentRequired = {
        ...paymentRequired,
        accepts: normalizePaymentRequirements(paymentRequired.accepts),
      };
    } catch (error) {
      return createErrorResponse(
        `解析PAYMENT-REQUIRED失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    
    // 3. 获取签名器
    const signModeResult = await selectSignModeAndGetPayFetch(
      signModeRegistry,
      signMode,
      walletLoginProvider
    );
    
    if (isCallToolResult(signModeResult)) {
      return signModeResult;
    }
    
    // 4. 创建支付payload
    const selectedMode = await signModeRegistry.selectMode(signMode);
    const signerSession = await selectedMode.mode.resolveSigner({ walletLoginProvider });
    
    const client = new X402ClientStandalone();
    const scheme = new ExactEvmScheme(signerSession.signer);
    
    // 注册所有网络
    for (const network of SUPPORTED_NETWORKS) {
      client.register(network, scheme);
    }
    
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = await client.createPaymentPayload(paymentRequired);
    } catch (error) {
      return createErrorResponse(
        `创建支付payload失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    
    // 5. 携带签名重新请求
    const init = buildRequestInit(method, body);
    const encoded = encodePaymentSignatureHeader(paymentPayload);
    
    const request = new Request(url, init);
    request.headers.set("PAYMENT-SIGNATURE", encoded);
    request.headers.set("Access-Control-Expose-Headers", "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE");
    
    const finalResponse = await fetch(request);
    const finalResponseText = await finalResponse.text();
    
    return await handleResponseWithBalanceCheck(finalResponse, finalResponseText);
  } catch (err) {
    return await handleRequestError(err);
  }
}

async function main(): Promise<void> {
  const quickWalletMcpUrl = process.env.QUICK_WALLET_SERVER_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const quickWalletApiKey = process.env.QUICK_WALLET_API_KEY;
  
  const pluginWalletBaseUrl = process.env.PLUGIN_WALLET_SERVER_URL ?? "https://walletmcp.gate.com/mcp";
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
      // 原有 x402_request 工具保留代码但不再对外暴露
      // {
      //   name: TOOL_NAME,
      //   description: TOOL_DESCRIPTION,
      //   inputSchema: INPUT_SCHEMA,
      // },
      {
        name: "x402_place_order",
        description: PLACE_ORDER_DESCRIPTION,
        inputSchema: PLACE_ORDER_INPUT_SCHEMA,
      },
      {
        name: "x402_sign_payment",
        description: SIGN_PAYMENT_DESCRIPTION,
        inputSchema: SIGN_PAYMENT_INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 处理新工具
    if (name === "x402_place_order") {
      return await handlePlaceOrder(args ?? {});
    }

    if (name === "x402_sign_payment") {
      return await handleSignPayment(args ?? {}, signModeRegistry);
    }

    // 保留原有 x402_request 工具的处理逻辑（虽然不再对外暴露）
    if (name === TOOL_NAME) {
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
    }

    return createErrorResponse(`未知工具: ${name}`);
  });

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
