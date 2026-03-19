/**
 * 测试 wallet-mcp-clients 能否调通远程 MCP Server 的 auth.google_login_start
 *
 * 使用方式：
 *   QUICK_WALLET_SERVER_URL=https://api.gatemcp.ai/mcp/dex QUICK_WALLET_API_KEY=你的key npm run test:wallet-mcp
 * 或先配置 .env 中的 QUICK_WALLET_SERVER_URL、QUICK_WALLET_API_KEY 后：
 *   npm run test:wallet-mcp
 */

import { config } from "dotenv";
import { getMcpClient } from "../src/wallets/wallet-mcp-clients.js";

config();

async function main() {
  const baseUrl = process.env.QUICK_WALLET_SERVER_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const apiKey = process.env.QUICK_WALLET_API_KEY;

  console.log("MCP Wallet 连接测试 (auth.google_login_start)");
  console.log("  QUICK_WALLET_SERVER_URL:", baseUrl);
  console.log("  QUICK_WALLET_API_KEY:", apiKey ? `${apiKey.slice(0, 8)}...` : "(未设置，将使用默认)");
  console.log("");

  const client = await getMcpClient({ serverUrl: baseUrl, apiKey });
  try {
    console.log("调用 auth.google_login_start ...");
    const result = await client.authGoogleLoginStart();
    console.log("结果:", JSON.stringify(result, null, 2));
    if (result && typeof result === "object" && "content" in result) {
      console.log("\n✓ 调通成功");
    } else {
      console.log("\n? 返回结构请自行核对");
    }
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
