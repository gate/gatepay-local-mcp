/**
 * Gate Pay OAuth access_token 进程内存储（中心化支付）。
 * 与托管钱包 GateMcpClient / mcp_token 完全分离。
 */

const EXPIRY_SKEW_MS = 60_000;
/** Gate Pay access_token 实际有效期（与 OAuth 侧一致，不因缺省 expires_in 误用更长 TTL） */
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

let gatePayAccessToken: string | null = null;
let gatePayTokenExpiresAtMs: number | null = null;
let gatePayTokenIssuedAtMs: number | null = null;

export function setGatePayAccessToken(token: string, expiresAtMs?: number | null): void {
  gatePayAccessToken = token;
  gatePayTokenIssuedAtMs = Date.now();
  gatePayTokenExpiresAtMs =
    expiresAtMs === undefined || expiresAtMs === null ? null : expiresAtMs;
}

function effectiveExpiresAtMs(): number | null {
  if (gatePayTokenIssuedAtMs == null) return null;
  const cappedByTtl = gatePayTokenIssuedAtMs + ACCESS_TOKEN_TTL_MS;
  if (gatePayTokenExpiresAtMs == null) return cappedByTtl;
  return Math.min(gatePayTokenExpiresAtMs, cappedByTtl);
}

function invalidateIfExpired(): void {
  if (!gatePayAccessToken) return;
  const expiresAt = effectiveExpiresAtMs();
  if (expiresAt == null) return;
  if (Date.now() >= expiresAt - EXPIRY_SKEW_MS) {
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
  gatePayTokenIssuedAtMs = null;
}
