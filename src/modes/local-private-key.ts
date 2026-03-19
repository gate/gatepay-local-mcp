import { createLocalPrivateKeySigner } from "./signers.js";
import type {
  ResolvedSignerSession,
  SignModeAvailability,
  SignModeDefinition,
} from "./types.js";

export class LocalPrivateKeyMode implements SignModeDefinition {
  readonly id = "local_private_key" as const;
  readonly priority = 10;

  checkAvailability(): SignModeAvailability {
    const privateKey = process.env.EVM_PRIVATE_KEY?.trim();
    if (!privateKey) {
      return {
        status: "not_configured",
        summary: "本地私钥模式未配置 EVM_PRIVATE_KEY。",
        missing: ["EVM_PRIVATE_KEY"],
      };
    }

    return {
      status: "ready",
      summary: "本地私钥模式可直接使用。",
    };
  }

  async resolveSigner(): Promise<ResolvedSignerSession> {
    const raw = process.env.EVM_PRIVATE_KEY?.trim();
    if (!raw) {
      throw new Error("EVM_PRIVATE_KEY is not set.");
    }

    const privateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    return {
      signer: createLocalPrivateKeySigner(privateKey),
    };
  }

  getCacheKey(): string {
    return this.id;
  }
}
