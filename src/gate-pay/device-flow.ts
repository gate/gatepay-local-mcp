/**
 * Gate Pay 授权：浏览器打开 Gate 授权页 → 用户同意后回调本机 localhost → 本地请求远程 OAuth 后端用授权码换取 access_token。无设备流 start/poll 轮询。
 *
 * 可选环境变量（覆盖默认测试环境）：
 *   GATE_PAY_OAUTH_TOKEN_URL       — 换 token 的完整 POST 地址（默认 dev 内网 token 路径）
 *   GATE_PAY_OAUTH_REFRESH_URL     — 刷新 token 的完整 POST 地址（未设时由 token URL 推导 …/refresh）
 *   GATE_PAY_OAUTH_TOKEN_BASE_URL  — 仅设置 origin 时，换 token 路径为 …/oauth2/oauth/internal/api/token
 *   GATE_PAY_OAUTH_MCP_SERVER_URL  — 同上，旧名，仍兼容
 *   GATE_PAY_OAUTH_CLIENT_SECRET   — authorization_code 换 token 必填（form 字段 client_secret）
 *   GATE_PAY_OAUTH_AUTHORIZE_URL        — Gate 授权页完整 URL（须含 /oauth/authorize 路径）
 *   GATE_PAY_OAUTH_AUTHORIZE_USER_AGENT — 预检 request_key 时的 User-Agent（默认 gateio/web）
 *   GATE_PAY_OAUTH_CLIENT_ID / GATE_PAY_OAUTH_SCOPE
 *   GATE_PAY_OAUTH_CALLBACK_PORT        — 本地回调监听端口，0 表示随机
 */

import { GateOAuth } from "./gate-oauth-class.js";
import { setGatePayAccessToken } from "./pay-token-store.js";
import type { GatePayDeviceFlowResult } from "./oauth-types.js";

export type { GateOAuthConfig, GatePayDeviceFlowResult, OAuthToken } from "./oauth-types.js";
export { GATE_DEFAULT_CONFIG } from "./gate-oauth-config.js";
export { openBrowser } from "./oauth-browser.js";
export { GateOAuth };

async function loginWithGatePayOAuthRedirect(): Promise<GatePayDeviceFlowResult> {
  console.error(
    "[Gate Pay] 请在浏览器完成授权；成功后将回调本机，并由本地调用远程接口获取 access_token。",
  );
  try {
    const oauth = new GateOAuth();
    const token = await oauth.login();
    console.error("[Gate Pay] setGatePayAccessToken 参数（全量）:", {
      accessToken: token.accessToken,
      expiresAtMs: token.expiresAt,
    });
    setGatePayAccessToken(
      token.accessToken,
      token.expiresAt,
      token.refreshToken,
      token.refreshTokenExpiresAt,
    );
    console.error("[Gate Pay] Authorized; access_token stored.");
    if (token.userId) console.error(`[Gate Pay] user_id: ${token.userId}`);
    if (token.walletAddress) {
      console.error(`[Gate Pay] wallet: ${token.walletAddress}`);
    }
    return true;
  } catch (err) {
    console.error(`[Gate Pay] OAuth failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Gate Pay 授权：浏览器 OAuth + localhost 回调 + 远程换 token。成功后写入 pay-token-store。
 */
export async function loginWithGatePayDeviceFlow(): Promise<GatePayDeviceFlowResult> {
  return loginWithGatePayOAuthRedirect();
}
