import type { ClientEvmSigner } from "../x402-standalone/types.js";

export type SignModeId = "local_private_key" | "quick_wallet" | "plugin_wallet";

export interface ResolveSignerContext {
  walletLoginProvider: "google" | "gate";
}

export interface ResolvedSignerSession {
  signer: ClientEvmSigner;
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
}

export interface PayFetchFactory {
  build(input: BuildPayFetchInput): typeof fetch;
}

export interface SelectModeResult {
  mode: SignModeDefinition;
  availability: SignModeAvailability;
}
