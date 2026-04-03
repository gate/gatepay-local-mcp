import type { ClientEvmSigner, ClientSvmSigner } from "../x402/types.js";

export type SignModeId = "local_private_key" | "quick_wallet" | "plugin_wallet";

export interface ResolveSignerContext {
  walletLoginProvider: "google" | "gate";
  /**
   * 指定需要哪些网络的签名器
   * - evm: 是否需要 EVM 签名器（默认 true）
   * - solana: 是否需要 Solana 签名器（默认 true，可设为 false 避免弹出连接请求）
   * 
   * 对于 plugin_wallet 模式，solana 签名器采用延迟加载：
   * - 如果 solana !== false，会创建延迟签名器，只在实际签名时才连接钱包
   * - 如果 solana === false，不会创建 Solana 签名器
   */
  networks?: {
    evm?: boolean;
    solana?: boolean;
  };
}

export interface ResolvedSignerSession {
  signer: ClientEvmSigner;
  solanaSigner?: ClientSvmSigner;
}

export type SignModeAvailability =
  | { status: "ready"; summary: string }
  | { status: "not_configured"; summary: string; missing: string[] }
  | { status: "needs_login"; summary: string; missing: string[] };

export interface SignModeDefinition {
  id: SignModeId;
  priority: number;
  checkAvailability(): Promise<SignModeAvailability> | SignModeAvailability;
  resolveSigner(context: ResolveSignerContext): Promise<ResolvedSignerSession>;
  getCacheKey?(context: ResolveSignerContext): string | Promise<string>;
}

export interface BuildPayFetchInput {
  signer: ClientEvmSigner;
  solanaSigner?: ClientSvmSigner;
}

export interface PayFetchFactory {
  build(input: BuildPayFetchInput): typeof fetch;
}

export interface SelectModeResult {
  mode: SignModeDefinition;
  availability: SignModeAvailability;
}
