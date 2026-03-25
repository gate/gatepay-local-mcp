import {
  GATE_DEFAULT_CONFIG,
  gateOAuthConfigFromEnv,
} from "./gate-oauth-config.js";
import { BaseLocalOAuth } from "./local-oauth-base.js";
import { logGatePayOAuth } from "./oauth-log.js";
import type { GateOAuthConfig, OAuthToken } from "./oauth-types.js";
import { normalizeGateTokenEnvelope } from "./oauth-token-exchange.js";

interface AuthorizePrecheckJson {
  code?: number;
  message?: string;
  data?: { requestKey?: string };
}

export class GateOAuth extends BaseLocalOAuth<GateOAuthConfig> {
  constructor(config?: Partial<GateOAuthConfig>) {
    super({ ...GATE_DEFAULT_CONFIG, ...gateOAuthConfigFromEnv(), ...config });
  }

  override async login(): Promise<OAuthToken> {
    logGatePayOAuth("login: 当前 GateOAuth 配置（全量）", {
      gateAuthEndpoint: this.config.gateAuthEndpoint,
      accountAuthorizeEndpoint: this.config.accountAuthorizeEndpoint,
      oauthTokenEndpoint: this.config.oauthTokenEndpoint,
      oauthRefreshEndpoint: this.config.oauthRefreshEndpoint,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      scope: this.config.scope,
      callbackPort: this.config.callbackPort,
      authorizeUserAgent: this.config.authorizeUserAgent,
    });
    return super.login();
  }

  /** 不含 request_key，与浏览器授权页同源查询参数（用于预检 JSON） */
  private buildAuthorizeBaseUrl(redirectUri: string): URL {
    const url = new URL(this.config.accountAuthorizeEndpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scope);
    return url;
  }

  /**
   * GET 授权 URL + User-Agent: gateio/web 时，部分环境返回 JSON（data.requestKey）；
   * 若服务端改为直接返回 HTML 登录页（仍 200 OK），则无法解析 JSON，此时返回 null，
   * 由 buildAuthUrl 使用不含 request_key 的标准 OAuth 查询串打开浏览器。
   */
  private async fetchAuthorizeRequestKey(
    authorizeUrlWithoutRequestKey: string,
  ): Promise<string | null> {
    logGatePayOAuth("authorize 预检: 请求（全量）", {
      method: "GET",
      url: authorizeUrlWithoutRequestKey,
      headers: {
        "User-Agent": this.config.authorizeUserAgent,
        Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const res = await fetch(authorizeUrlWithoutRequestKey, {
      redirect: "follow",
      headers: {
        "User-Agent": this.config.authorizeUserAgent,
        Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
      },
    });
    logGatePayOAuth("authorize 预检: HTTP 状态（全量）", {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      url: res.url,
    });
    const text = await res.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text.trim());
    } catch {
      if (res.ok) {
        logGatePayOAuth(
          "authorize 预检: 响应不是 JSON（常见为 HTML 授权页），跳过 request_key",
          {
            contentType: res.headers.get("content-type"),
            bodyPrefix: text.slice(0, 80).replace(/\s+/g, " "),
          },
        );
        return null;
      }
      throw new Error(
        `OAuth authorize 预检：响应不是 JSON（${res.status} ${res.statusText}）`,
      );
    }
    logGatePayOAuth("authorize 预检: 响应 JSON（全量）", raw);
    const json = raw as AuthorizePrecheckJson;
    if (typeof json.code === "number" && json.code !== 0) {
      const msg =
        typeof json.message === "string" && json.message
          ? json.message
          : `authorize 预检失败 code=${json.code}`;
      throw new Error(msg);
    }
    const rk = json.data?.requestKey;
    if (typeof rk !== "string" || !rk) {
      if (res.ok) {
        logGatePayOAuth(
          "authorize 预检: JSON 中无 data.requestKey，跳过 request_key",
          raw,
        );
        return null;
      }
      throw new Error("OAuth authorize 预检：响应缺少 data.requestKey");
    }
    logGatePayOAuth("authorize 预检: request_key（全量）", rk);
    return rk;
  }

  protected async buildAuthUrl(redirectUri: string): Promise<string> {
    const url = this.buildAuthorizeBaseUrl(redirectUri);
    const precheckUrl = url.toString();
    logGatePayOAuth("buildAuthUrl: 预检前 URL 查询参数（全量）", {
      href: precheckUrl,
      client_id: url.searchParams.get("client_id"),
      redirect_uri: url.searchParams.get("redirect_uri"),
      response_type: url.searchParams.get("response_type"),
      scope: url.searchParams.get("scope"),
    });
    const requestKey = await this.fetchAuthorizeRequestKey(precheckUrl);
    if (requestKey) {
      url.searchParams.set("request_key", requestKey);
    }
    const finalUrl = url.toString();
    logGatePayOAuth(
      requestKey
        ? "buildAuthUrl: 浏览器授权完整 URL（含 request_key）"
        : "buildAuthUrl: 浏览器授权 URL（无 request_key）",
      finalUrl,
    );
    return finalUrl;
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthToken> {
    const clientSecret = this.config.clientSecret;
    if (!clientSecret) {
      throw new Error(
        "Gate Pay OAuth: 请设置环境变量 GATE_PAY_OAUTH_CLIENT_SECRET（或构造参数 clientSecret）以换取 access_token",
      );
    }
    logGatePayOAuth("换 token: 请求（全量）", {
      method: "POST",
      url: this.config.oauthTokenEndpoint,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_secret: clientSecret,
      },
    });
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_secret: clientSecret,
    });
    const res = await fetch(this.config.oauthTokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    logGatePayOAuth("换 token: HTTP 状态（全量）", {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      url: res.url,
    });
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new Error(
        `Token exchange: response is not JSON (${res.status} ${res.statusText})`,
      );
    }
    logGatePayOAuth("换 token: 响应 JSON（全量）", raw);
    if (!res.ok) {
      throw new Error(
        `Token exchange failed: ${res.status} ${res.statusText} ${JSON.stringify(raw)}`,
      );
    }
    const tok = this.parseTokenResponse(normalizeGateTokenEnvelope(raw));
    logGatePayOAuth("换 token: 解析后 token 对象（全量）", {
      accessToken: tok.accessToken,
      tokenType: tok.tokenType,
      expiresIn: tok.expiresIn,
      expiresAt: tok.expiresAt,
      userId: tok.userId,
      walletAddress: tok.walletAddress,
      refreshToken: tok.refreshToken ? "(已返回)" : undefined,
    });
    return tok;
  }

  /**
   * POST refresh_token + client_secret 换取新的 access_token（与 curl 示例一致：form-urlencoded）。
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthToken> {
    const clientSecret = this.config.clientSecret;
    if (!clientSecret) {
      throw new Error(
        "Gate Pay OAuth: 请设置环境变量 GATE_PAY_OAUTH_CLIENT_SECRET（或构造参数 clientSecret）以刷新 access_token",
      );
    }
    const url = this.config.oauthRefreshEndpoint;
    logGatePayOAuth("刷新 token: 请求（全量）", {
      method: "POST",
      url,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: {
        refresh_token: refreshToken,
        client_secret: clientSecret,
      },
    });
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_secret: clientSecret,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    logGatePayOAuth("刷新 token: HTTP 状态（全量）", {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      url: res.url,
    });
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new Error(
        `Token refresh: response is not JSON (${res.status} ${res.statusText})`,
      );
    }
    logGatePayOAuth("刷新 token: 响应 JSON（全量）", raw);
    if (!res.ok) {
      throw new Error(
        `Token refresh failed: ${res.status} ${res.statusText} ${JSON.stringify(raw)}`,
      );
    }
    const tok = this.parseTokenResponse(normalizeGateTokenEnvelope(raw));
    const nextRefresh = tok.refreshToken ?? refreshToken;
    const merged: OAuthToken = { ...tok, refreshToken: nextRefresh };
    logGatePayOAuth("刷新 token: 解析后 token 对象（全量）", {
      accessToken: merged.accessToken,
      tokenType: merged.tokenType,
      expiresIn: merged.expiresIn,
      expiresAt: merged.expiresAt,
      userId: merged.userId,
      walletAddress: merged.walletAddress,
      refreshToken: "(已保留或更新)",
    });
    return merged;
  }
}
