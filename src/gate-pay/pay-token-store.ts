/**
 * Gate Pay OAuth access_token 进程内存储（中心化支付）。
 * 与托管钱包 GateMcpClient / mcp_token 完全分离。
 */

import {
  GATE_DEFAULT_CONFIG,
  gateOAuthConfigFromEnv,
} from "./gate-oauth-config.js";
import { GateOAuth } from "./gate-oauth-class.js";

const EXPIRY_SKEW_MS = 60_000;
/** 接口未返回 access 过期时间时，自签发起默认有效时长 */
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

let gatePayAccessToken: string | null = null;
/** 与当前 access_token 关联的 Gate 用户 id（换 token / 登录时写入；仅刷新且响应未带 uid 时保留原值） */
let gatePayUserId: string | null = null;
let gatePayRefreshToken: string | null = null;
let gatePayRefreshTokenExpiresAtMs: number | null = null;
let gatePayTokenExpiresAtMs: number | null = null;
let gatePayTokenIssuedAtMs: number | null = null;

let ensureInFlight: Promise<boolean> | null = null;

export function setGatePayAccessToken(
  token: string,
  expiresAtMs?: number | null,
  refreshToken?: string | null,
  refreshTokenExpiresAtMs?: number | null,
  /** 传入则更新进程内 uid；不传则保留原值（用于刷新接口未返回 user_id 时） */
  userId?: string,
): void {
  gatePayAccessToken = token;
  gatePayTokenIssuedAtMs = Date.now();
  gatePayTokenExpiresAtMs =
    expiresAtMs === undefined || expiresAtMs === null ? null : expiresAtMs;
  if (refreshToken !== undefined) {
    gatePayRefreshToken =
      typeof refreshToken === "string" && refreshToken ? refreshToken : null;
  }
  if (refreshTokenExpiresAtMs !== undefined) {
    gatePayRefreshTokenExpiresAtMs =
      refreshTokenExpiresAtMs === null ? null : refreshTokenExpiresAtMs;
  }
  if (userId !== undefined) {
    gatePayUserId = userId.length > 0 ? userId : null;
  }
}

function effectiveExpiresAtMs(): number | null {
  if (gatePayTokenIssuedAtMs == null) return null;
  if (gatePayTokenExpiresAtMs != null) return gatePayTokenExpiresAtMs;
  return gatePayTokenIssuedAtMs + ACCESS_TOKEN_TTL_MS;
}

/**
 * 无 refresh_token 时，临近过期仍从内存清除；有 refresh_token 时保留 access_token，
 * 由 ensureGatePayAccessTokenFresh 在过期窗口内主动刷新。
 */
function invalidateIfExpired(): void {
  if (!gatePayAccessToken) return;
  const expiresAt = effectiveExpiresAtMs();
  if (expiresAt == null) return;
  if (Date.now() >= expiresAt - EXPIRY_SKEW_MS) {
    if (!gatePayRefreshToken) {
      clearGatePayAccessToken();
    }
  }
}

async function doEnsureGatePayAccessTokenFresh(): Promise<boolean> {
  if (!gatePayAccessToken) return false;

  const exp = effectiveExpiresAtMs();
  if (exp == null || Date.now() < exp - EXPIRY_SKEW_MS) {
    return true;
  }

  if (!gatePayRefreshToken) {
    clearGatePayAccessToken();
    return false;
  }

  if (
    gatePayRefreshTokenExpiresAtMs != null &&
    Date.now() >= gatePayRefreshTokenExpiresAtMs - EXPIRY_SKEW_MS
  ) {
    console.error(
      "[Gate Pay] refresh_token 已过期或即将过期，请重新完成浏览器 OAuth。",
    );
    clearGatePayAccessToken();
    return false;
  }

  const merged = { ...GATE_DEFAULT_CONFIG, ...gateOAuthConfigFromEnv() };
  const secret = merged.clientSecret?.trim();
  if (!secret) {
    console.error(
      "[Gate Pay] 缺少 GATE_PAY_OAUTH_CLIENT_SECRET，无法刷新 token，请重新 OAuth。",
    );
    clearGatePayAccessToken();
    return false;
  }

  try {
    const oauth = new GateOAuth({ clientSecret: secret });
    const tok = await oauth.refreshAccessToken(gatePayRefreshToken);
    const uidFromRefresh =
      typeof tok.userId === "string" && tok.userId.length > 0
        ? tok.userId
        : undefined;
    setGatePayAccessToken(
      tok.accessToken,
      tok.expiresAt,
      tok.refreshToken ?? gatePayRefreshToken,
      tok.refreshTokenExpiresAt,
      uidFromRefresh,
    );
    console.error("[Gate Pay] access_token 已刷新。");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Gate Pay] token 刷新失败: ${msg}`);
    clearGatePayAccessToken();
    return false;
  }
}

/**
 * 在 access_token 进入过期窗口（默认提前 60s）时，若有 refresh_token 则调用刷新接口。
 * 并发调用会合并为同一刷新请求。
 */
export function ensureGatePayAccessTokenFresh(): Promise<boolean> {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = doEnsureGatePayAccessTokenFresh().finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

export function isGatePayTokenUsable(): boolean {
  invalidateIfExpired();
  return gatePayAccessToken !== null;
}

export function getGatePayAccessToken(): string | null {
  invalidateIfExpired();
  return gatePayAccessToken;
}

/** 与当前有效会话关联的 uid；无会话或历史未写入时为 null */
export function getGatePayUserId(): string | null {
  invalidateIfExpired();
  return gatePayUserId;
}

export function clearGatePayAccessToken(): void {
  gatePayAccessToken = null;
  gatePayUserId = null;
  gatePayRefreshToken = null;
  gatePayRefreshTokenExpiresAtMs = null;
  gatePayTokenExpiresAtMs = null;
  gatePayTokenIssuedAtMs = null;
}
