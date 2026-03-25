/**
 * Gate Pay 授权：浏览器打开 Gate 授权页 → 用户同意后回调本机 localhost → 本地请求远程 OAuth 后端用授权码换取 access_token。无设备流 start/poll 轮询。
 *
 * 可选环境变量（覆盖默认测试环境）：
 *   GATE_PAY_OAUTH_TOKEN_URL       — 换 token 的完整 POST 地址（默认 dev 内网 token 路径）
 *   GATE_PAY_OAUTH_TOKEN_BASE_URL  — 仅设置 origin 时，换 token 路径为 …/oauth2/oauth/internal/api/token
 *   GATE_PAY_OAUTH_MCP_SERVER_URL  — 同上，旧名，仍兼容
 *   GATE_PAY_OAUTH_CLIENT_SECRET   — authorization_code 换 token 必填（form 字段 client_secret）
 *   GATE_PAY_OAUTH_AUTHORIZE_URL        — Gate 授权页完整 URL（须含 /oauth/authorize 路径）
 *   GATE_PAY_OAUTH_AUTHORIZE_USER_AGENT — 预检 request_key 时的 User-Agent（默认 gateio/web）
 *   GATE_PAY_OAUTH_CLIENT_ID / GATE_PAY_OAUTH_SCOPE
 *   GATE_PAY_OAUTH_CALLBACK_PORT        — 本地回调监听端口，0 表示随机
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { setGatePayAccessToken } from "./pay-token-store.js";

const GATE_PAY_OAUTH_LOG = "[Gate Pay OAuth]";

function logGatePayOAuth(msg: string, detail?: unknown): void {
  if (detail === undefined) {
    console.error(`${GATE_PAY_OAUTH_LOG} ${msg}`);
    return;
  }
  const serialized =
    typeof detail === "string"
      ? detail
      : JSON.stringify(detail, null, 2);
  console.error(`${GATE_PAY_OAUTH_LOG} ${msg}`, serialized);
}

export async function openBrowser(url: string): Promise<boolean> {
  logGatePayOAuth("openBrowser: 参数 url（全量）", url);
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(cmd, [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    printManualUrl(url);
    return false;
  }
}

function printManualUrl(url: string): void {
  const termLink = `\x1b]8;;${url}\x1b\\Click here to open\x1b]8;;\x1b\\`;
  console.error("");
  console.error(`\x1b[33m⚠  Could not open browser automatically.\x1b[0m`);
  console.error(`\x1b[1m   ${termLink}\x1b[0m  or copy the URL below:`);
  console.error("");
  console.error(`   \x1b[36m${url}\x1b[0m`);
  console.error("");
}

export type GatePayDeviceFlowResult = boolean;

// ─── 本地回调 + 远程换 token ─────────────────────────────────────────

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
  userId: string;
  walletAddress?: string | undefined;
}

interface TokenExchangeResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  /** 部分后端字段名为 expired_in */
  expired_in?: number;
  user_id?: string;
  uid?: number;
  wallet_address?: string;
  error?: string;
}

/** 换 token 接口：`{ code: 200, data: { access_token, expired_in, uid, ... } }` */
function normalizeGateTokenEnvelope(raw: unknown): TokenExchangeResponse {
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
    return {
      access_token:
        typeof d.access_token === "string" ? d.access_token : undefined,
      token_type: typeof d.token_type === "string" ? d.token_type : undefined,
      expires_in,
      user_id: uid != null ? String(uid) : undefined,
      error: typeof r.error === "string" ? r.error : undefined,
    };
  }
  return raw as TokenExchangeResponse;
}

/** 从 OAuth 换 token 接口 JSON 中取 bearer（兼容多种后端字段名） */
function bearerTokenFromExchangeJson(data: Record<string, unknown>): string | undefined {
  const a = data.access_token;
  if (typeof a === "string" && a) return a;
  const b = data["mcp_token"];
  if (typeof b === "string" && b) return b;
  return undefined;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Success</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 48px; border-radius: 12px; text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .check { font-size: 48px; margin-bottom: 16px; }
  h2 { color: #1a1a1a; margin: 0 0 8px; }
  p { color: #666; margin: 0; }
</style></head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h2>Authorization Successful</h2>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Error</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 48px; border-radius: 12px; text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h2 { color: #e53e3e; margin: 0 0 8px; }
  p { color: #666; margin: 0; }
</style></head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h2>Authorization Failed</h2>
    <p>${msg}</p>
  </div>
</body>
</html>`;

interface BaseOAuthConfig {
  callbackPort: number;
}

abstract class BaseLocalOAuth<C extends BaseOAuthConfig> {
  protected config: C;
  private token: OAuthToken | null = null;
  private server: Server | null = null;

  constructor(config: C) {
    this.config = config;
  }

  /** 拼装浏览器打开的授权页 URL（可异步拉取 request_key 等） */
  protected abstract buildAuthUrl(redirectUri: string): Promise<string>;
  protected abstract exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthToken>;

  /**
   * OAuth 登录：本地起监听 → 拼装带 redirect_uri 的授权 URL → 浏览器打开授权页 →
   * 用户在 IdP 确认后浏览器重定向回 localhost，由监听收到 code → 再换 token。
   * 注意：必须先启动监听并得到实际端口，才能拼进 authUrl 的 redirect_uri，因此不能先打开浏览器再起服务。
   */
  async login(): Promise<OAuthToken> {
    logGatePayOAuth("login: 开始（本地回调 → 授权页 → 换 token）");
    const { code, redirectUri } = await this.waitForAuthorizationCode();
    logGatePayOAuth("login: 已收到浏览器回调参数", {
      code,
      redirect_uri: redirectUri,
    });
    const tok = await this.exchangeCode(code, redirectUri);
    this.token = tok;
    logGatePayOAuth("login: 完成，token 全字段", {
      accessToken: tok.accessToken,
      tokenType: tok.tokenType,
      expiresIn: tok.expiresIn,
      expiresAt: tok.expiresAt,
      userId: tok.userId,
      walletAddress: tok.walletAddress,
    });
    return tok;
  }

  /** 启动 localhost 回调监听，拼装 authUrl 并打开浏览器，直到收到授权码或失败/超时 */
  private waitForAuthorizationCode(): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let callbackPort = 0;

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1`);
        logGatePayOAuth("回调: HTTP 请求", {
          method: req.method,
          url: req.url,
          href: url.href,
          pathname: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
        });
        if (url.pathname !== "/callback") {
          logGatePayOAuth(`回调: 非 /callback 路径，忽略 ${url.pathname}`);
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");

        if (error) {
          const msg = errorDesc ?? error;
          logGatePayOAuth("回调: IdP 错误参数（全量）", {
            error,
            error_description: errorDesc,
            message: msg,
          });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ERROR_HTML(msg));
          this.closeServer();
          reject(new Error(`OAuth error: ${msg}`));
          return;
        }

        if (!code) {
          logGatePayOAuth("回调: 查询串中无 code", {
            query: Object.fromEntries(url.searchParams.entries()),
          });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ERROR_HTML("No authorization code received"));
          this.closeServer();
          reject(new Error("No authorization code received"));
          return;
        }

        logGatePayOAuth("回调: 成功，授权码与 state 等（全量 query）", {
          code,
          state: url.searchParams.get("state"),
          query: Object.fromEntries(url.searchParams.entries()),
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(SUCCESS_HTML);

        const redirectUri = `http://localhost:${callbackPort}/callback`;
        this.closeServer();
        resolve({ code, redirectUri });
      });

      this.server = server;

      let loginTimeout: ReturnType<typeof setTimeout> | undefined;

      const onSigint = () => {
        logGatePayOAuth("login: 收到 SIGINT，取消登录并关闭本地监听");
        if (loginTimeout !== undefined) clearTimeout(loginTimeout);
        this.closeServer();
        reject(new Error("Login cancelled by user"));
      };
      process.once("SIGINT", onSigint);

      server.listen(this.config.callbackPort, "127.0.0.1", () => {
        // 1) 本地端口已监听，确定 OAuth redirect_uri（须先于授权 URL 拼装）
        callbackPort = (server.address() as { port: number }).port;
        const redirectUri = `http://localhost:${callbackPort}/callback`;
        logGatePayOAuth("本地回调监听已就绪（参数）", {
          host: "127.0.0.1",
          port: callbackPort,
          redirect_uri: redirectUri,
          configured_callbackPort: this.config.callbackPort,
        });

        // 2) 拼装 Gate 授权页 URL（含预检 request_key 等）→ 3) 浏览器打开
        void (async () => {
          try {
            logGatePayOAuth("正在拼装授权 URL（含 authorize 预检 request_key）…");
            const authUrl = await this.buildAuthUrl(redirectUri);
            logGatePayOAuth("正在打开系统浏览器，完整授权 URL", authUrl);
            void openBrowser(authUrl);
          } catch (err) {
            logGatePayOAuth(
              `授权 URL / 预检失败: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.removeListener("SIGINT", onSigint);
            if (loginTimeout !== undefined) clearTimeout(loginTimeout);
            this.closeServer();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });

      server.on("error", (err) => {
        logGatePayOAuth(`本地监听启动失败: ${err.message}`);
        process.removeListener("SIGINT", onSigint);
        if (loginTimeout !== undefined) clearTimeout(loginTimeout);
        reject(new Error(`Failed to start local server: ${err.message}`));
      });

      loginTimeout = setTimeout(
        () => {
          logGatePayOAuth("login: 超过 5 分钟未收到回调，超时");
          process.removeListener("SIGINT", onSigint);
          this.closeServer();
          reject(new Error("OAuth login timed out (5 minutes)"));
        },
        5 * 60 * 1000,
      );
      loginTimeout.unref();
    });
  }

  protected parseTokenResponse(data: TokenExchangeResponse): OAuthToken {
    if (data.error) {
      throw new Error(data.error);
    }
    const accessToken = bearerTokenFromExchangeJson(
      data as unknown as Record<string, unknown>,
    );
    if (!accessToken) {
      throw new Error("No access_token in response");
    }
    const ttlSec = data.expires_in ?? data.expired_in ?? 3600;
    return {
      accessToken,
      tokenType: data.token_type ?? "Bearer",
      expiresIn: ttlSec,
      expiresAt: Date.now() + ttlSec * 1000,
      userId: data.user_id ?? (data.uid != null ? String(data.uid) : ""),
      walletAddress: data.wallet_address,
    };
  }

  private closeServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  getToken(): OAuthToken | null {
    if (this.token && Date.now() >= this.token.expiresAt) {
      this.token = null;
    }
    return this.token;
  }

  setToken(token: OAuthToken): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
    this.closeServer();
  }
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
  /** GET 授权预检（取 request_key）时使用的 User-Agent，须与 gateio/web 一致才返回 JSON */
  authorizeUserAgent: string;
}

const DEFAULT_OAUTH_TOKEN_PATH = "/oauth2/oauth/internal/api/token";

/** 默认测试环境；生产请通过环境变量或构造参数覆盖 */
export const GATE_DEFAULT_CONFIG: GateOAuthConfig = {
  oauthTokenEndpoint:
    "http://dev.halftrust.xyz/oauth2/oauth/internal/api/token",
  gateAuthEndpoint: "http://dev.halftrust.xyz/oauth2/oauth/authorize",
  accountAuthorizeEndpoint: "https://14099.gateio.tech/account-authorize",
  clientId: "mZ96D37oKk-HrWJc",
  clientSecret: "QcICEvHYl4zlqd27AD8Grw1s78ni989RK1t3igeRdN0=",
  scope: "read_profile",
  callbackPort: 8090,
  authorizeUserAgent: "gateio/web",
};

function gateOAuthConfigFromEnv(): Partial<GateOAuthConfig> {
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
    });
    return tok;
  }
}

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
    setGatePayAccessToken(token.accessToken, token.expiresAt);
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
