import type { GateOAuthConfig } from "./oauth-types.js";

const DEFAULT_OAUTH_TOKEN_PATH = "/oauth2/oauth/internal/api/token";

/** 由换 token URL 推导刷新 URL（末尾 `/token` → `/refresh`） */
export function deriveOAuthRefreshUrlFromTokenUrl(tokenUrl: string): string {
  if (tokenUrl.endsWith("/token")) {
    return `${tokenUrl.slice(0, -"/token".length)}/refresh`;
  }
  return tokenUrl.replace(/\/token(?=$|[?#])/, "/refresh");
}

/** 默认测试环境；生产请通过环境变量或构造参数覆盖 */
export const GATE_DEFAULT_CONFIG: GateOAuthConfig = {
  oauthTokenEndpoint:
    "http://dev.halftrust.xyz/oauth2/oauth/internal/api/token",
  oauthRefreshEndpoint:
    "http://dev.halftrust.xyz/oauth2/oauth/internal/api/refresh",
  gateAuthEndpoint: "http://dev.halftrust.xyz/oauth2/oauth/authorize",
  accountAuthorizeEndpoint: "https://14099.gateio.tech/account-authorize",
  clientId: "mZ96D37oKk-HrWJc",
  clientSecret: "",
  scope: "read_profile",
  callbackPort: 8090,
  authorizeUserAgent: "gateio/web",
};

export function gateOAuthConfigFromEnv(): Partial<GateOAuthConfig> {
  const partial: Partial<GateOAuthConfig> = {};
  const tokenUrl = process.env.GATE_PAY_OAUTH_TOKEN_URL?.trim();
  const base =
    process.env.GATE_PAY_OAUTH_TOKEN_BASE_URL?.trim() ||
    process.env.GATE_PAY_OAUTH_MCP_SERVER_URL?.trim();
  if (tokenUrl) {
    partial.oauthTokenEndpoint = tokenUrl;
  } else if (base) {
    const origin = base.replace(/\/$/, "");
    partial.oauthTokenEndpoint = `${origin}${DEFAULT_OAUTH_TOKEN_PATH}`;
  }
  const refreshUrl = process.env.GATE_PAY_OAUTH_REFRESH_URL?.trim();
  if (refreshUrl) {
    partial.oauthRefreshEndpoint = refreshUrl;
  } else {
    const tokenEp =
      partial.oauthTokenEndpoint ?? GATE_DEFAULT_CONFIG.oauthTokenEndpoint;
    partial.oauthRefreshEndpoint = tokenEp.endsWith("/refresh")
      ? tokenEp
      : deriveOAuthRefreshUrlFromTokenUrl(tokenEp);
  }
  const auth = process.env.GATE_PAY_OAUTH_AUTHORIZE_URL?.trim();
  if (auth) partial.gateAuthEndpoint = auth;
  const accountAuth = process.env.GATE_PAY_ACCOUNT_AUTHORIZE_URL?.trim();
  if (accountAuth) partial.accountAuthorizeEndpoint = accountAuth;
  const authUa = process.env.GATE_PAY_OAUTH_AUTHORIZE_USER_AGENT?.trim();
  if (authUa) partial.authorizeUserAgent = authUa;
  const cid = process.env.GATE_PAY_OAUTH_CLIENT_ID?.trim();
  if (cid) partial.clientId = cid;
  const secret = process.env.GATE_PAY_OAUTH_CLIENT_SECRET?.trim();
  if (secret) partial.clientSecret = secret;
  const scope = process.env.GATE_PAY_OAUTH_SCOPE?.trim();
  if (scope) partial.scope = scope;
  const portStr = process.env.GATE_PAY_OAUTH_CALLBACK_PORT?.trim();
  if (portStr) {
    const n = parseInt(portStr, 10);
    if (!Number.isNaN(n)) partial.callbackPort = n;
  }
  return partial;
}
