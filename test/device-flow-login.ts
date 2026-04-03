/**
 * 测试 device-flow-login：授权登录并获取 token
 *
 * 交互式测试：会打开浏览器，需在限定时间内完成 Gate/Google 授权，成功后校验 mcp_token 已写入 client。
 *
 * 使用方式：
 *   QUICK_WALLET_SERVER_URL=https://api.gatemcp.ai/mcp/dex QUICK_WALLET_API_KEY=你的key npm run test:device-flow-login
 * 或配置 .env 后：npm run test:device-flow-login
 *
 * 可选环境变量：
 *   DEVICE_FLOW_PROVIDER=gate | google  默认 gate
 */

import { config } from "dotenv";
import { getMcpClient } from "../src/wallets/wallet-mcp-clients.js";
import { loginWithDeviceFlow } from "../src/wallets/device-flow-login.js";

config();

async function main() {
  const baseUrl =
    process.env.QUICK_WALLET_SERVER_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const apiKey = process.env.QUICK_WALLET_API_KEY;
  const providerEnv = (process.env.DEVICE_FLOW_PROVIDER ?? "gate").toLowerCase();
  const isGoogle = providerEnv === "google";
  const provider = isGoogle ? "Google" : "Gate";

  console.error("Device Flow 登录测试（授权后获取 token）");
  console.error("  QUICK_WALLET_SERVER_URL:", baseUrl);
  console.error("  QUICK_WALLET_API_KEY:", apiKey ? `${apiKey.slice(0, 8)}...` : "(未设置)");
  console.error("  Provider:", provider);
  console.error("  请在浏览器中完成授权，否则将超时。\n");

  const client = await getMcpClient({ serverUrl: baseUrl, apiKey });
  try {
    console.error("→ Calling MCP auth start + poll until authorized...\n");
    const ok = await loginWithDeviceFlow(client, baseUrl, isGoogle, provider, {
      saveToken: false,
      reportAddresses: false,
    });

    if (!ok) {
      console.error("\n✗ 登录未完成（取消、失败或超时）");
      process.exit(1);
    }

    const token = client.getMcpToken();
    if (!token) {
      console.error("\n✗ 登录返回成功但 client 上无 mcp_token");
      process.exit(1);
    }

    const masked = token.length > 12 ? `${token.slice(0, 8)}...${token.slice(-4)}` : "***";
    console.error("\n✓ 验证通过：已通过授权登录并获取 token");
    console.error("  mcp_token (masked):", masked);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
