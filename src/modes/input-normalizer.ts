import type { SignModeId } from "./types.js";

export interface RawX402RequestInput {
  url?: unknown;
  method?: unknown;
  body?: unknown;
  sign_mode?: unknown;
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
    signMode,
    walletLoginProvider,
  };
}
