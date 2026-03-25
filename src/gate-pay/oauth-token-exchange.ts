export interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  /** 部分后端字段名为 expired_in */
  expired_in?: number;
  user_id?: string;
  uid?: number;
  wallet_address?: string;
  /** 刷新接口等可能返回，单位：秒（自返回时刻起 refresh_token 剩余有效期） */
  refresh_token_expires_in?: number;
  error?: string;
}

/** 换 token 接口：`{ code: 200, data: { access_token, expired_in, uid, ... } }` */
export function normalizeGateTokenEnvelope(raw: unknown): TokenExchangeResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("Token exchange: invalid JSON response");
  }
  const r = raw as Record<string, unknown>;
  if (r.data && typeof r.data === "object") {
    const apiCode = r.code;
    if (typeof apiCode === "number" && apiCode !== 200) {
      const msg =
        typeof r.message === "string" && r.message
          ? r.message
          : `Token API error code ${apiCode}`;
      throw new Error(msg);
    }
    const d = r.data as Record<string, unknown>;
    const expires_in =
      typeof d.expires_in === "number"
        ? d.expires_in
        : typeof d.expired_in === "number"
          ? d.expired_in
          : undefined;
    const uid = d.uid;
    const refresh_token_expires_in =
      typeof d.refresh_token_expires_in === "number"
        ? d.refresh_token_expires_in
        : typeof d.refresh_token_expired_in === "number"
          ? d.refresh_token_expired_in
          : undefined;
    return {
      access_token:
        typeof d.access_token === "string" ? d.access_token : undefined,
      refresh_token:
        typeof d.refresh_token === "string" ? d.refresh_token : undefined,
      token_type: typeof d.token_type === "string" ? d.token_type : undefined,
      expires_in,
      refresh_token_expires_in,
      user_id: uid != null ? String(uid) : undefined,
      error: typeof r.error === "string" ? r.error : undefined,
    };
  }
  return raw as TokenExchangeResponse;
}

/** 从 OAuth 换 token 接口 JSON 中取 bearer（兼容多种后端字段名） */
export function bearerTokenFromExchangeJson(
  data: Record<string, unknown>,
): string | undefined {
  const a = data.access_token;
  if (typeof a === "string" && a) return a;
  const b = data["mcp_token"];
  if (typeof b === "string" && b) return b;
  return undefined;
}
