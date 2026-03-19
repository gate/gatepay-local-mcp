import type {
  ResolvedSignerSession,
  SignModeAvailability,
  SignModeDefinition,
} from "./types.js";

export class PluginWalletMode implements SignModeDefinition {
  readonly id = "plugin_wallet" as const;
  readonly priority = 30;

  checkAvailability(): SignModeAvailability {
    return {
      status: "not_configured",
      summary: "plugin_wallet 尚未接入，可作为后续扩展模式。",
      missing: ["plugin_wallet_not_implemented"],
    };
  }

  async resolveSigner(): Promise<ResolvedSignerSession> {
    throw new Error("plugin_wallet is not implemented yet.");
  }

  getCacheKey(): string {
    return this.id;
  }
}
