import { createSignerFromMcpWallet } from "../x402-standalone/signer.js";
import { loadAuth } from "../x402-standalone/wallet/auth-token-store.js";
import { loginWithDeviceFlow } from "../x402-standalone/wallet/device-flow-login.js";
import { getMcpClient } from "../x402-standalone/wallet/wallet-mcp-clients.js";
import type {
  ResolveSignerContext,
  ResolvedSignerSession,
  SignModeAvailability,
  SignModeDefinition,
} from "./types.js";

export interface QuickWalletModeOptions {
  mcpWalletUrl: string;
  mcpApiKey?: string;
}

export class QuickWalletMode implements SignModeDefinition {
  readonly id = "quick_wallet" as const;
  readonly priority = 20;

  constructor(private readonly options: QuickWalletModeOptions) {}

  checkAvailability(): SignModeAvailability {
    const savedAuth = loadAuth();
    if (savedAuth?.mcp_token) {
      return {
        status: "ready",
        summary: "quick_wallet 已存在可用登录态。",
      };
    }

    return {
      status: "needs_login",
      summary: "quick_wallet 需要先完成登录。",
      missing: ["mcp_token"],
    };
  }

  async resolveSigner(context: ResolveSignerContext): Promise<ResolvedSignerSession> {
    const mcp = await getMcpClient({
      serverUrl: this.options.mcpWalletUrl,
      apiKey: this.options.mcpApiKey,
    });

    const savedAuth = loadAuth();
    if (savedAuth?.mcp_token) {
      mcp.setMcpToken(savedAuth.mcp_token);
    } else {
      const isGoogle = context.walletLoginProvider === "google";
      const providerLabel = isGoogle ? "Google" : "Gate";
      console.error(
        `[x402_request] quick_wallet: no saved token, starting ${providerLabel} device-flow login…`,
      );

      const loginOk = await loginWithDeviceFlow(
        mcp,
        this.options.mcpWalletUrl,
        isGoogle,
        providerLabel,
        {
          saveToken: true,
          reportAddresses: false,
        },
      );

      if (!loginOk) {
        throw new Error("quick_wallet login did not complete (cancelled, failed, or timed out)");
      }
    }

    return {
      signer: await createSignerFromMcpWallet(mcp),
    };
  }

  getCacheKey(): string {
    return this.id;
  }
}
