/**
 * 简单测试：Solana 签名器创建
 * 
 * 运行方式: npm run test:solana-signer
 */
import { config } from "dotenv";
import { createLocalSolanaPrivateKeySigner } from "../src/modes/signers.js";

config();

async function main() {
  const solanaPrivateKey = process.env.SVM_PRIVATE_KEY;

  if (!solanaPrivateKey) {
    console.error("❌ 错误: 请在 .env 文件中设置 SVM_PRIVATE_KEY");
    console.error("   格式: base58 编码的字符串 (例如: 5J7...)");
    process.exit(1);
  }

  console.log("🔐 创建 Solana 签名器...\n");

  try {
    const signer = await createLocalSolanaPrivateKeySigner(solanaPrivateKey);

    console.log("✅ Solana 签名器创建成功!");
    console.log(`📍 地址: ${signer.address}\n`);

    console.log("📝 签名器信息:");
    console.log(`   - 地址: ${signer.address}`);
    console.log(`   - 类型: TransactionSigner`);
    console.log(`   - 支持网络: solana:mainnet, solana:devnet, solana:testnet`);
  } catch (error) {
    console.error("❌ 创建签名器失败:", error);
    process.exit(1);
  }
}

main();
