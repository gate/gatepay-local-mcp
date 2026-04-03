import type { GateOAuthConfig } from "./oauth-types.js";
import { getEnvConfig } from "../config/env-config.js";

const DEFAULT_OAUTH_TOKEN_PATH = "/oauth/internal/api/token";
const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
const ACCOUNT_AUTHORIZE_PATH = "/account-authorize";

function resolvedOAuthBackendOrigin(): string {
  const envConfig = getEnvConfig();
  const envVar = process.env.GATE_PAY_OAUTH_BACKEND_ORIGIN?.trim();
  return (envVar || envConfig.oauthBackendOrigin).replace(/\/$/, "");
}

function resolvedAccountAuthorizeOrigin(): string {
  const envConfig = getEnvConfig();
  const envVar = process.env.GATE_PAY_ACCOUNT_AUTHORIZE_ORIGIN?.trim();
  return (envVar || envConfig.accountAuthorizeOrigin).replace(/\/$/, "");
}

/** 由换 token URL 推导刷新 URL（末尾 `/token` → `/refresh`） */
export function deriveOAuthRefreshUrlFromTokenUrl(tokenUrl: string): string {
  if (tokenUrl.endsWith("/token")) {
    return `${tokenUrl.slice(0, -"/token".length)}/refresh`;
  }
  return tokenUrl.replace(/\/token(?=$|[?#])/, "/refresh");
}

const _defaultTokenEndpoint = `${resolvedOAuthBackendOrigin()}${DEFAULT_OAUTH_TOKEN_PATH}`;

/** 从环境配置获取默认配置 */
export const GATE_DEFAULT_CONFIG: GateOAuthConfig = (() => {
  const envConfig = getEnvConfig();
  return {
    oauthTokenEndpoint: _defaultTokenEndpoint,
    oauthRefreshEndpoint: deriveOAuthRefreshUrlFromTokenUrl(_defaultTokenEndpoint),
    gateAuthEndpoint: `${resolvedOAuthBackendOrigin()}${OAUTH_AUTHORIZE_PATH}`,
    accountAuthorizeEndpoint: `${resolvedAccountAuthorizeOrigin()}${ACCOUNT_AUTHORIZE_PATH}`,
    clientId: envConfig.oauthClientId,
    clientSecret: envConfig.oauthClientSecret,
    scope: envConfig.oauthScope,
    callbackPort: envConfig.oauthCallbackPort,
    authorizeUserAgent: envConfig.oauthAuthorizeUserAgent,
  };
})();

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
  const portStr = process.env.GATE_PAY_OAUTH_CALLBACK_PORT?.trim();
  if (portStr) {
    const n = parseInt(portStr, 10);
    if (!Number.isNaN(n)) partial.callbackPort = n;
  }
  return partial;
}
