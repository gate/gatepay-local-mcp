import { createLocalPrivateKeySigner, createLocalSolanaPrivateKeySigner } from "./signers/index.js";
import type {
  ResolvedSignerSession,
  SignModeAvailability,
  SignModeDefinition,
} from "./types.js";

export class LocalPrivateKeyMode implements SignModeDefinition {
  readonly id = "local_private_key" as const;
  readonly priority = 10;

  checkAvailability(): SignModeAvailability {
    const evmPrivateKey = process.env.EVM_PRIVATE_KEY?.trim();
    const solanaPrivateKey = process.env.SVM_PRIVATE_KEY?.trim();
    
    const missing: string[] = [];
    if (!evmPrivateKey) {
      missing.push("EVM_PRIVATE_KEY");
    }
    if (!solanaPrivateKey) {
      missing.push("SVM_PRIVATE_KEY");
    }

    if (missing.length > 0) {
      return {
        status: "not_configured",
        summary: `本地私钥模式未配置：${missing.join(", ")}。`,
        missing,
      };
    }

    return {
      status: "ready",
      summary: "本地私钥模式可直接使用（支持 EVM 和 Solana）。",
    };
  }

  async resolveSigner(): Promise<ResolvedSignerSession> {
    const evmRaw = process.env.EVM_PRIVATE_KEY?.trim();
    if (!evmRaw) {
      throw new Error("EVM_PRIVATE_KEY is not set.");
    }

    const evmPrivateKey = (evmRaw.startsWith("0x") ? evmRaw : `0x${evmRaw}`) as `0x${string}`;
    const signer = createLocalPrivateKeySigner(evmPrivateKey);

    // Solana 签名器（可选）
    const solanaRaw = process.env.SVM_PRIVATE_KEY?.trim();
    let solanaSigner = undefined;
    if (solanaRaw) {
      try {
        solanaSigner = await createLocalSolanaPrivateKeySigner(solanaRaw);
      } catch (error) {
        console.warn("⚠️  创建 Solana 签名器失败，将仅使用 EVM 签名器:", error);
      }
    }

    return {
      signer,
      solanaSigner,
    };
  }

  getCacheKey(): string {
    return this.id;
  }
}
