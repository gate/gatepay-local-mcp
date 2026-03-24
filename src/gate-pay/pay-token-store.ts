/**
 * Gate Pay OAuth access_token 进程内存储（中心化支付）。
 * 与托管钱包 GateMcpClient / mcp_token 完全分离。
 */

const EXPIRY_SKEW_MS = 60_000;

let gatePayAccessToken: string | null = null;
let gatePayTokenExpiresAtMs: number | null = null;

export function setGatePayAccessToken(token: string, expiresAtMs?: number | null): void {
  gatePayAccessToken = token;
  gatePayTokenExpiresAtMs =
    expiresAtMs === undefined || expiresAtMs === null ? null : expiresAtMs;
}

function invalidateIfExpired(): void {
  if (!gatePayAccessToken) return;
  if (gatePayTokenExpiresAtMs == null) return;
  if (Date.now() >= gatePayTokenExpiresAtMs - EXPIRY_SKEW_MS) {
    clearGatePayAccessToken();
  }
}

export function isGatePayTokenUsable(): boolean {
  invalidateIfExpired();
  return gatePayAccessToken !== null;
}

export function getGatePayAccessToken(): string | null {
  invalidateIfExpired();
  return gatePayAccessToken;
}

export function clearGatePayAccessToken(): void {
  gatePayAccessToken = null;
  gatePayTokenExpiresAtMs = null;
}
