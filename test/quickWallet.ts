/**
 * 直接用 src 里的代码发起 x402 请求：quick_wallet → Quick Wallet MCP → flight/order。
 * 不经过 MCP 子进程，方便断点调试。
 *
 * Quick Wallet 使用设备流登录，支持自动化测试。
 * 首次运行会引导完成设备流登录（Google 或 Gate），
 * 登录后会保存 token，后续运行自动使用已保存的 token。
 *
 * 可选环境变量：
 * - QUICK_WALLET_SERVER_URL：Quick Wallet MCP 地址（默认：https://api.gatemcp.ai/mcp/dex）
 * - QUICK_WALLET_API_KEY：API Key（可选）
 * - QUICK_WALLET_PROVIDER：登录提供商 google|gate（默认：gate）
 * - 可在项目根目录 .env 中配置
 *
 * 使用方式：
 *   npm run test:quickWallet
 * 或指定环境变量：
 *   QUICK_WALLET_SERVER_URL=https://api.gatemcp.ai/mcp/dex npm run test:quickWallet
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { QuickWalletMode } from "../src/modes/quick-wallet.js";
import {
  createSignModeRegistry,
  formatSignModeSelectionError,
} from "../src/modes/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
config({ path: join(packageRoot, ".env") });

const DEFAULT_QUICK_WALLET_URL = "https://wallet-service-mcp-test.gateweb3.cc/mcp";

const REQUEST = {
  url: "https://webws.gate.io:443/flight/order",
  method: "POST" as const,
  body: '{"flightId":"FL002","uid":"100","chain":"SOL","fullCurrType":"USDC_SOL"}',
};

function buildRequestInit(method: string, body?: string): RequestInit {
  if (method === "GET") {
    return { method: "GET" };
  }
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    if (body?.trim()) {
      JSON.parse(body);
    }
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: body?.trim() ? body : undefined,
    };
  }
  throw new Error(`不支持的 method: ${method}`);
}

async function main(): Promise<void> {
  const mcpWalletUrl =
    process.env.QUICK_WALLET_SERVER_URL?.trim() || DEFAULT_QUICK_WALLET_URL;
  const mcpApiKey = 'MCP_AK_8W2N7Q';
  const provider = (process.env.QUICK_WALLET_PROVIDER?.trim() || "gate") as "gate" | "google";

  console.log("=== Quick Wallet 测试 ===");
  console.log("MCP Server URL:", mcpWalletUrl);
  console.log("API Key:", mcpApiKey ? `${mcpApiKey.slice(0, 8)}...` : "(未设置)");
  console.log("登录提供商:", provider === "google" ? "Google" : "Gate");
  console.log("");

  const registry = createSignModeRegistry([
    new QuickWalletMode({ mcpWalletUrl, mcpApiKey }),
  ]);

  let payFetch: typeof fetch;
  try {
    console.log("正在选择并初始化 quick_wallet 模式...");
    const { mode } = await registry.selectMode("quick_wallet");
    payFetch = await registry.getOrCreatePayFetch(mode, {
      walletLoginProvider: provider,
    });
    console.log("✓ quick_wallet 模式初始化成功");
    console.log("");
  } catch (error) {
    const formatted = formatSignModeSelectionError(error);
    console.error("✗ 选择/初始化 quick_wallet 失败:", formatted);
    
    // 如果是需要继续确认的情况（登录成功但需要用户确认）
    if (formatted.includes("如果你想继续用这个接口进行支付，请回复yes")) {
      console.log("\n提示：如需继续测试支付流程，请重新运行此脚本");
    }
    
    process.exit(1);
  }

  const init = buildRequestInit(REQUEST.method, REQUEST.body);
  console.log("=== 发起 x402 支付请求 ===");
  console.log("URL:", REQUEST.url);
  console.log("Method:", REQUEST.method);
  console.log("Body:", REQUEST.body);
  console.log("");

  try {
    const response = await payFetch(REQUEST.url, init);
    const responseText = await response.text();

    let text: string;
    try {
      const json = JSON.parse(responseText) as { data?: unknown };
      text = json.data != null ? JSON.stringify(json.data, null, 2) : JSON.stringify(json, null, 2);
    } catch {
      text = responseText;
    }

    console.log("=== 响应内容 ===");
    console.log(text);
    console.log("");

    if (!response.ok && response.status !== 402) {
      console.error("✗ HTTP 错误:", response.status);
      process.exit(1);
    }

    console.log("✓ 完成：已通过 quick_wallet 成功访问 flight/order");
  } catch (error) {
    console.error("✗ 请求失败:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("✗ 未预期的错误:", error);
  process.exit(1);
});
