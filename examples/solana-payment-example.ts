/**
 * 示例：使用 Solana 网络进行 x402 支付
 * 
 * 本示例展示如何使用本地私钥在 Solana 网络上进行支付
 */
import { config } from "dotenv";
import { X402ClientStandalone } from "../src/x402/client.js";
import { wrapFetchWithPayment } from "../src/x402/fetch.js";
import { ExactEvmScheme } from "../src/x402/exactEvmScheme.js";
import { ExactSvmScheme } from "../src/x402/exactSvmScheme.js";
import { createLocalPrivateKeySigner, createLocalSolanaPrivateKeySigner } from "../src/modes/signers.js";

config();

/**
 * 使用本地私钥创建同时支持 EVM 和 Solana 的支付客户端
 * 
 * 环境变量要求：
 * - EVM_PRIVATE_KEY: EVM 私钥 (0x开头的hex字符串)
 * - SVM_PRIVATE_KEY: Solana 私钥 (base58编码的字符串)
 * - RESOURCE_SERVER_URL: 资源服务器地址
 * - ENDPOINT_PATH: 请求的端点路径
 */
async function main(): Promise<void> {
  const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
  const solanaPrivateKey = process.env.SVM_PRIVATE_KEY as string;
  const baseURL = process.env.RESOURCE_SERVER_URL || "https://webws.gate.io:443";
  const endpointPath = process.env.ENDPOINT_PATH || "/flight/order";
  const url = `${baseURL}${endpointPath}`;

  // 创建签名器
  const evmSigner = createLocalPrivateKeySigner(evmPrivateKey);
  console.log("solanaPrivateKey", solanaPrivateKey);
  const solanaSigner = await createLocalSolanaPrivateKeySigner(solanaPrivateKey);

  // 创建 x402 客户端并注册支付方案
  const client = new X402ClientStandalone();

  // 注册 EVM 网络
  const evmNetworks = [
    "gatelayer_testnet",
    "eth",
    "base",
    "Polygon",
    "gatelayer",
    "gatechain",
    "Arbitrum One",
  ];
  for (const network of evmNetworks) {
    client.register(network, new ExactEvmScheme(evmSigner));
  }

  // 注册 Solana 网络
  const solanaNetworks = ["solana"];
  for (const network of solanaNetworks) {
    client.register(network, new ExactSvmScheme(solanaSigner));
  }

  // 创建带支付功能的 fetch
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // 发起请求
  console.log(`Making request to: ${url}\n`);
  const response = await fetchWithPayment(url, { method: "POST" });

  // 处理响应
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  console.log("Response body:", body);
}

main().catch((error) => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
