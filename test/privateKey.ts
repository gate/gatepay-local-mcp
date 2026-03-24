/**
 * 直接用 src 里的代码发起 x402 请求：local_private_key → 本地私钥签名 → flight/order。
 * 不经过 MCP 子进程，方便断点调试。
 *
 * 可选环境变量：
 * - EVM_PRIVATE_KEY：本地私钥（必需）
 * - RESOURCE_SERVER_URL：目标服务器地址，默认 https://webws.gate.io:443
 * - ENDPOINT_PATH：接口路径，默认 /flight/order
 * - 可在项目根目录 .env 中配置
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LocalPrivateKeyMode } from "../src/modes/local-private-key.js";
import {
  createSignModeRegistry,
  formatSignModeSelectionError,
} from "../src/modes/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
config({ path: join(packageRoot, ".env") });

const baseURL = process.env.RESOURCE_SERVER_URL || "https://dev.halftrust.xyz/pay-disputemanagement";
const endpointPath = process.env.ENDPOINT_PATH || "/flight/order";

const REQUEST = {
  url: `${baseURL}${endpointPath}`,
  method: "POST" as const,
  body: '{"flightId": "FL002","uid": "100","chain":"SOL","fullCurrType":"USDC_SOL"}',
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
  const evmPrivateKey = process.env.EVM_PRIVATE_KEY?.trim();
  const svmPrivateKey = process.env.SVM_PRIVATE_KEY?.trim();

  if (!evmPrivateKey) {
    console.error("❌ 缺少 EVM_PRIVATE_KEY 环境变量");
    process.exit(1);
  }

  console.log("🔐 私钥配置状态:");
  console.log(`   ✅ EVM_PRIVATE_KEY: 已配置`);
  console.log(`   ${svmPrivateKey ? '✅' : '⚠️ '} SVM_PRIVATE_KEY: ${svmPrivateKey ? '已配置（支持 Solana 网络）' : '未配置（仅支持 EVM 网络）'}\n`);

  const registry = createSignModeRegistry([
    new LocalPrivateKeyMode(),
  ]);

  let payFetch: typeof fetch;
  try {
    const { mode } = await registry.selectMode("local_private_key");
    payFetch = await registry.getOrCreatePayFetch(mode, {
      walletLoginProvider: "gate",
    });
  } catch (error) {
    console.error("选择/初始化 local_private_key 失败:", formatSignModeSelectionError(error));
    process.exit(1);
  }

  const init = buildRequestInit(REQUEST.method, REQUEST.body);
  console.log(`请求: ${REQUEST.url} ${REQUEST.method}`);
  console.log(`请求体: ${REQUEST.body}`);

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
  
  console.log(`\n✓ 完成：已通过 local_private_key 访问 ${REQUEST.url}。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
