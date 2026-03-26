import type { GateOAuthConfig } from "./oauth-types.js";

const DEFAULT_OAUTH_TOKEN_PATH = "/oauth2/oauth/internal/api/token";
const OAUTH_AUTHORIZE_PATH = "/oauth2/oauth/authorize";
const ACCOUNT_AUTHORIZE_PATH = "/account-authorize";

/** 换 token / 授权页所在服务根地址（不含末尾 `/`），默认测试环境 */
const DEFAULT_OAUTH_BACKEND_ORIGIN = "http://dev.halftrust.xyz";
/** 账户授权页所在服务根地址（不含末尾 `/`） */
const DEFAULT_ACCOUNT_AUTHORIZE_ORIGIN = "https://14099.gateio.tech";
/** 本地 OAuth 回调监听端口（可被环境变量覆盖） */
const DEFAULT_CALLBACK_PORT = 18473;

/** 读取 `GATE_PAY_OAUTH_CALLBACK_PORT`；未设置或非法时返回 `undefined` */
function parseCallbackPortFromEnv(): number | undefined {
  const portStr = process.env.GATE_PAY_OAUTH_CALLBACK_PORT?.trim();
  if (!portStr) return undefined;
  const n = parseInt(portStr, 10);
  return Number.isNaN(n) ? undefined : n;
}

function resolvedOAuthBackendOrigin(): string {
  const v = process.env.GATE_PAY_OAUTH_BACKEND_ORIGIN?.trim();
  return (v || DEFAULT_OAUTH_BACKEND_ORIGIN).replace(/\/$/, "");
}

function resolvedAccountAuthorizeOrigin(): string {
  const v = process.env.GATE_PAY_ACCOUNT_AUTHORIZE_ORIGIN?.trim();
  return (v || DEFAULT_ACCOUNT_AUTHORIZE_ORIGIN).replace(/\/$/, "");
}

/** 由换 token URL 推导刷新 URL（末尾 `/token` → `/refresh`） */
export function deriveOAuthRefreshUrlFromTokenUrl(tokenUrl: string): string {
  if (tokenUrl.endsWith("/token")) {
    return `${tokenUrl.slice(0, -"/token".length)}/refresh`;
  }
  return tokenUrl.replace(/\/token(?=$|[?#])/, "/refresh");
}

const _defaultTokenEndpoint = `${resolvedOAuthBackendOrigin()}${DEFAULT_OAUTH_TOKEN_PATH}`;

/** 默认测试环境；生产请通过环境变量或构造参数覆盖 */
export const GATE_DEFAULT_CONFIG: GateOAuthConfig = {
  oauthTokenEndpoint: _defaultTokenEndpoint,
  oauthRefreshEndpoint: deriveOAuthRefreshUrlFromTokenUrl(_defaultTokenEndpoint),
  gateAuthEndpoint: `${resolvedOAuthBackendOrigin()}${OAUTH_AUTHORIZE_PATH}`,
  accountAuthorizeEndpoint: `${resolvedAccountAuthorizeOrigin()}${ACCOUNT_AUTHORIZE_PATH}`,
  clientId: "mZ96D37oKk-HrWJc",
  clientSecret: "",
  scope: "read_profile",
  callbackPort: parseCallbackPortFromEnv() ?? DEFAULT_CALLBACK_PORT,
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
  } else {
    const backendOriginEnv = process.env.GATE_PAY_OAUTH_BACKEND_ORIGIN?.trim();
    if (backendOriginEnv) {
      const origin = backendOriginEnv.replace(/\/$/, "");
      partial.oauthTokenEndpoint = `${origin}${DEFAULT_OAUTH_TOKEN_PATH}`;
    }
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
  if (auth) {
    partial.gateAuthEndpoint = auth;
  } else {
    const backendOriginEnv = process.env.GATE_PAY_OAUTH_BACKEND_ORIGIN?.trim();
    if (backendOriginEnv) {
      partial.gateAuthEndpoint = `${backendOriginEnv.replace(/\/$/, "")}${OAUTH_AUTHORIZE_PATH}`;
    }
  }
  const accountAuth = process.env.GATE_PAY_ACCOUNT_AUTHORIZE_URL?.trim();
  if (accountAuth) {
    partial.accountAuthorizeEndpoint = accountAuth;
  } else {
    const acctOriginEnv = process.env.GATE_PAY_ACCOUNT_AUTHORIZE_ORIGIN?.trim();
    if (acctOriginEnv) {
      partial.accountAuthorizeEndpoint = `${acctOriginEnv.replace(/\/$/, "")}${ACCOUNT_AUTHORIZE_PATH}`;
    }
  }
  const authUa = process.env.GATE_PAY_OAUTH_AUTHORIZE_USER_AGENT?.trim();
  if (authUa) partial.authorizeUserAgent = authUa;
  const cid = process.env.GATE_PAY_OAUTH_CLIENT_ID?.trim();
  if (cid) partial.clientId = cid;
  const secret = process.env.GATE_PAY_OAUTH_CLIENT_SECRET?.trim();
  if (secret) partial.clientSecret = secret;
  const scope = process.env.GATE_PAY_OAUTH_SCOPE?.trim();
  if (scope) partial.scope = scope;
  const callbackPort = parseCallbackPortFromEnv();
  if (callbackPort !== undefined) partial.callbackPort = callbackPort;
  return partial;
}
