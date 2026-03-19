/**
 * 测试 createSignerFromMcpWallet：从已认证的 MCP 客户端创建 ClientEvmSigner，
 * 并验证通过 wallet.sign_transaction（signTypedData）生成签名。
 *
 * 依赖：需已登录并保存 token（~/.gate-pay/auth.json），否则先运行 npm run test:device-flow-login
 *
 * 使用方式：
 *   MCP_WALLET_URL=... MCP_WALLET_API_KEY=... npm run test:signer-mcp
 * 或配置 .env 后：npm run test:signer-mcp
 */

import { config } from "dotenv";
import { getAddress } from "viem";
import { getMcpClient } from "../src/wallets/wallet-mcp-clients.js";
import { loadAuth } from "../src/wallets/auth-token-store.js";
import { createQuickWalletSigner } from "../src/modes/signers.js";
import { createNonce } from "../src/x402/utils.js";

config();

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function typedDataToJsonString(data: unknown): string {
  return JSON.stringify(
    data,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

async function main() {
  const baseUrl =
    process.env.MCP_WALLET_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const apiKey = process.env.MCP_WALLET_API_KEY;

  console.log("createSignerFromMcpWallet 测试");
  console.log("  MCP_WALLET_URL:", baseUrl);
  console.log("  MCP_WALLET_API_KEY:", apiKey ? `${apiKey.slice(0, 8)}...` : "(未设置)");

  const mcp = await getMcpClient({ serverUrl: baseUrl, apiKey });
  const savedAuth = loadAuth();
  if (!savedAuth?.mcp_token) {
    console.error("\n✗ 未检测到已保存的 token。请先运行: npm run test:device-flow-login");
    await mcp.disconnect();
    process.exit(1);
  }
  mcp.setMcpToken(savedAuth.mcp_token);

  try {
        const signer = await createQuickWalletSigner(mcp);
    if (!signer.address || !signer.address.startsWith("0x")) {
      console.error("\n✗ signer.address 无效:", signer.address);
      process.exit(1);
    }
    console.log("\n✓ createSignerFromMcpWallet 成功");
    console.log("  address:", signer.address);
    if (typeof signer.signDigest !== "function") {
      console.error("✗ signer.signDigest 不是函数");
      process.exit(1);
    }
    if (typeof signer.signTypedData !== "function") {
      console.error("✗ signer.signTypedData 不是函数");
      process.exit(1);
    }
    console.log("  signDigest: 已就绪");
    console.log("  signTypedData (sign_transaction): 已就绪");

    const now = Math.floor(Date.now() / 1000);
    const nonce = createNonce();
    const payTo = "0xf6b26Ebf56A0C3C6796604828E4722373c785027" as const;
    const domain = {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    };
    const message = {
      from: getAddress(signer.address),
      to: getAddress(payTo),
      value: BigInt("1"),
      validAfter: BigInt(now - 600),
      validBefore: BigInt(now + 600),
      nonce,
    };
    const typedData = {
      domain,
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization" as const,
      message,
    };
    console.log("\n[typedData 完整内容]\n" + typedDataToJsonString(typedData));
    console.log("\n→ 调用 signTypedData (TransferWithAuthorization, 与 exactEvmScheme 一致)...");
    const sig = await signer.signTypedData(typedData);
    console.log("\n[签名结果 signature]");
    console.log(sig);
    if (!sig || !sig.startsWith("0x") || sig.length < 130) {
      console.error("✗ signTypedData(sign_transaction) 返回的签名无效:", sig);
      process.exit(1);
    }
    console.log("  长度 (字符):", sig.length);
    console.log("\n✓ sign_transaction 测试通过");
  } finally {
    await mcp.disconnect();
  }
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
