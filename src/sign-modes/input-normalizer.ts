import type { SignModeId } from "./types.js";

export interface RawX402RequestInput {
  url?: unknown;
  method?: unknown;
  body?: unknown;
  sign_mode?: unknown;
  auth_mode?: unknown;
  wallet_login_provider?: unknown;
}

export interface NormalizedX402RequestInput {
  url: string;
  method: string;
  body?: string;
  signMode?: SignModeId | string;
  walletLoginProvider: "google" | "gate";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

export function normalizeX402RequestInput(
  input: RawX402RequestInput,
): NormalizedX402RequestInput {
  const signMode = normalizeOptionalString(input.sign_mode);
  const authMode = normalizeOptionalString(input.auth_mode);
  const method = normalizeOptionalString(input.method)?.toUpperCase() ?? "POST";
  const body = normalizeOptionalString(input.body);
  const walletLoginProvider =
    normalizeOptionalString(input.wallet_login_provider)?.toLowerCase() === "google"
      ? "google"
      : "gate";

  return {
    url: normalizeOptionalString(input.url) ?? "",
    method,
    body,
    signMode: signMode ?? mapLegacyAuthMode(authMode),
    walletLoginProvider,
  };
}

function mapLegacyAuthMode(authMode?: string): SignModeId | string | undefined {
  if (!authMode) return undefined;
  if (authMode === "quick_wallet") return "quick_wallet";
  return authMode;
}
