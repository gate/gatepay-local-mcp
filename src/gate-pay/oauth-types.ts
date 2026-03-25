export type GatePayDeviceFlowResult = boolean;

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
  userId: string;
  walletAddress?: string | undefined;
  /** 换 token / 刷新成功时由服务端返回，用于临近过期时刷新 access_token */
  refreshToken?: string | undefined;
  /** 对应服务端 `refresh_token_expires_in`（秒）换算的绝对时间戳（ms） */
  refreshTokenExpiresAt?: number | undefined;
}

export interface BaseOAuthConfig {
  callbackPort: number;
}

export interface GateOAuthConfig extends BaseOAuthConfig {
  gateAuthEndpoint: string;
  /** 浏览器授权与预检 request_key 使用的完整 URL（与 gateAuthEndpoint 分离，便于保留原 OAuth authorize 配置） */
  accountAuthorizeEndpoint: string;
  clientId: string;
  scope: string;
  /** authorization_code 换 token 时作为 client_secret 提交 */
  clientSecret: string;
  /** POST application/x-www-form-urlencoded 的换 token 完整 URL */
  oauthTokenEndpoint: string;
  /** POST application/x-www-form-urlencoded 的刷新 token 完整 URL */
  oauthRefreshEndpoint: string;
  /** GET 授权预检（取 request_key）时使用的 User-Agent，须与 gateio/web 一致才返回 JSON */
  authorizeUserAgent: string;
}
