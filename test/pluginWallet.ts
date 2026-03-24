/**
 * 直接用 src 里的代码发起 x402 请求：plugin_wallet → 插件钱包 MCP → flight/order。
 * 不经过 MCP 子进程，方便断点调试。
 *
 * 唤醒插件钱包：在 Node 下调用时，MCP 无法主动唤起浏览器扩展弹窗。
 * 请先在浏览器中打开 Gate Wallet 扩展并完成连接（或打开与 PLUGIN_WALLET_URL 同会话的页面），
 * 再运行本脚本。
 *
 * 可选环境变量：
 * - PLUGIN_WALLET_URL：插件钱包 MCP 地址（见下方默认值）
 * - 可在项目根目录 .env 中配置
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PluginWalletMode } from "../src/modes/plugin-wallet.js";
import {
  createSignModeRegistry,
  formatSignModeSelectionError,
} from "../src/modes/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
config({ path: join(packageRoot, ".env") });

const DEFAULT_PLUGIN_WALLET_URL =
  "https://walletmcp-test.gateweb3.cc/mcp?token=Z_GWbn9TMAnWBH0Fj3M73";

const REQUEST = {
  url: "https://dev.halftrust.xyz/pay-disputemanagement/flight/order",
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
  const pluginWalletUrl =
    process.env.PLUGIN_WALLET_URL?.trim() || DEFAULT_PLUGIN_WALLET_URL;

  const registry = createSignModeRegistry([
    new PluginWalletMode({ serverUrl: pluginWalletUrl }),
  ]);

  let payFetch: typeof fetch;
  try {
    const { mode } = await registry.selectMode("plugin_wallet");
    payFetch = await registry.getOrCreatePayFetch(mode, {
      walletLoginProvider: "gate",
    });
  } catch (error) {
    console.error("选择/初始化 plugin_wallet 失败:", formatSignModeSelectionError(error));
    process.exit(1);
  }

  const init = buildRequestInit(REQUEST.method, REQUEST.body);
  console.error("请求:", REQUEST.url, REQUEST.method, REQUEST.body);

  const response = await payFetch(REQUEST.url, init);
  const responseText = await response.text();

  let text: string;
  try {
    const json = JSON.parse(responseText) as { data?: unknown };
    text = json.data != null ? JSON.stringify(json.data, null, 2) : JSON.stringify(json, null, 2);
  } catch {
    text = responseText;
  }

  console.log("--- 响应 ---\n", text);
  if (!response.ok && response.status !== 402) {
    console.error("HTTP", response.status);
    process.exit(1);
  }
  console.error("\n✓ 完成：已通过 plugin_wallet 访问 flight/order。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
