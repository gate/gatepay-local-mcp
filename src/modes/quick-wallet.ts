import { createQuickWalletSigner } from "./signers.js";
import { loginWithDeviceFlow } from "../wallets/device-flow-login.js";
import { getMcpClient } from "../wallets/wallet-mcp-clients.js";
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

function parseMcpPayload(text: string): unknown {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractAddressPayload(result: unknown): unknown {
  if (result == null || typeof result !== "object" || !("content" in result)) {
    return result;
  }
  const content = (result as { content?: unknown[] }).content;
  const first = Array.isArray(content)
    ? (content[0] as { type?: string; text?: string } | undefined)
    : undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    return result;
  }
  return parseMcpPayload(first.text) ?? first.text;
}

export class QuickWalletMode implements SignModeDefinition {
  readonly id = "quick_wallet" as const;
  readonly priority = 20;

  constructor(private readonly options: QuickWalletModeOptions) {}

  async checkAvailability(): Promise<SignModeAvailability> {
    try {
      const mcp = await getMcpClient({
        serverUrl: this.options.mcpWalletUrl,
        apiKey: this.options.mcpApiKey,
      });
      if (mcp.isMcpTokenUsable()) {
        return {
          status: "ready",
          summary: "quick_wallet 进程内已有有效 MCP 登录态。",
        };
      }
    } catch {
      // 连接失败时不阻断显式选择 quick_wallet，交由 resolveSigner 再试
    }
    return {
      status: "needs_login",
      summary: "quick_wallet 需设备流登录（无有效进程内 token 或已过期）。",
      missing: ["mcp_token"],
    };
  }

  async resolveSigner(context: ResolveSignerContext): Promise<ResolvedSignerSession> {
    const mcp = await getMcpClient({
      serverUrl: this.options.mcpWalletUrl,
      apiKey: this.options.mcpApiKey,
    });

    if (!mcp.isMcpTokenUsable()) {
      const isGoogle = context.walletLoginProvider === "google";
      const providerLabel = isGoogle ? "Google" : "Gate";
      console.error(
        `[x402_request] quick_wallet: 无有效 MCP token（缺失或已过期），开始 ${providerLabel} 设备流登录…`,
      );

      const loginOk = await loginWithDeviceFlow(
        mcp,
        this.options.mcpWalletUrl,
        isGoogle,
        providerLabel,
        {
          saveToken: false,
          reportAddresses: false,
        },
      );

      if (!loginOk) {
        throw new Error("quick_wallet login did not complete (cancelled, failed, or timed out)");
      }

      const addressResult = await mcp.walletGetAddresses();
      const addresses = extractAddressPayload(addressResult);
      throw new Error(
        [
          "quick_wallet 登录成功。",
          `钱包地址信息：${JSON.stringify(addresses, null, 2)}`,
          "如果你想继续用这个接口进行支付，请回复yes",
        ].join("\n"),
      );
    }

    return {
      signer: await createQuickWalletSigner(mcp),
    };
  }

  getCacheKey(): string {
    return this.id;
  }
}
