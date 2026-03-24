/**
 * Gate Pay 授权：浏览器打开 Gate 授权页 → 用户同意后回调本机 localhost → 本地请求远程 OAuth 后端用授权码换取 access_token。无设备流 start/poll 轮询。
 *
 * 可选环境变量（覆盖默认测试环境）：
 *   GATE_PAY_OAUTH_TOKEN_BASE_URL — 换 token 的 HTTPS 服务基址（优先）
 *   GATE_PAY_OAUTH_MCP_SERVER_URL — 同上，旧名，仍兼容
 *   GATE_PAY_OAUTH_AUTHORIZE_URL  — Gate 授权页
 *   GATE_PAY_OAUTH_CLIENT_ID / GATE_PAY_OAUTH_SCOPE
 *   GATE_PAY_OAUTH_CALLBACK_PORT  — 本地回调监听端口，0 表示随机
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { setGatePayAccessToken } from "./pay-token-store.js";

export async function openBrowser(url: string): Promise<boolean> {
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
  user_id?: string;
  wallet_address?: string;
  error?: string;
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
  /** HTTPS 基址，用于 code → access_token 的 REST 调用 */
  oauthTokenBaseUrl: string;
  callbackPort: number;
}

abstract class BaseLocalOAuth<C extends BaseOAuthConfig> {
  protected config: C;
  private token: OAuthToken | null = null;
  private server: Server | null = null;

  constructor(config: C) {
    this.config = config;
  }

  protected abstract buildAuthUrl(redirectUri: string): string;
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
    const { code, redirectUri } = await this.waitForAuthorizationCode();
    const tok = await this.exchangeCode(code, redirectUri);
    this.token = tok;
    return tok;
  }

  /** 启动 localhost 回调监听，拼装 authUrl 并打开浏览器，直到收到授权码或失败/超时 */
  private waitForAuthorizationCode(): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let callbackPort = 0;

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1`);
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");

        if (error) {
          const msg = errorDesc ?? error;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ERROR_HTML(msg));
          this.closeServer();
          reject(new Error(`OAuth error: ${msg}`));
          return;
        }

        if (!code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ERROR_HTML("No authorization code received"));
          this.closeServer();
          reject(new Error("No authorization code received"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(SUCCESS_HTML);

        const redirectUri = `http://localhost:${callbackPort}/callback`;
        this.closeServer();
        resolve({ code, redirectUri });
      });

      this.server = server;

      const onSigint = () => {
        this.closeServer();
        reject(new Error("Login cancelled by user"));
      };
      process.once("SIGINT", onSigint);

      server.listen(this.config.callbackPort, "127.0.0.1", () => {
        // 1) 本地端口已监听，确定 OAuth redirect_uri（须先于授权 URL 拼装）
        callbackPort = (server.address() as { port: number }).port;
        const redirectUri = `http://localhost:${callbackPort}/callback`;

        // 2) 拼装 Gate 授权页 URL（含 client_id、redirect_uri、scope 等）
        const authUrl = this.buildAuthUrl(redirectUri);

        // 3) 浏览器打开授权页；用户确认后 IdP 重定向到上述 redirect_uri，由本 server 处理回调
        void openBrowser(authUrl);
      });

      server.on("error", (err) => {
        process.removeListener("SIGINT", onSigint);
        reject(new Error(`Failed to start local server: ${err.message}`));
      });

      const timeout = setTimeout(
        () => {
          process.removeListener("SIGINT", onSigint);
          this.closeServer();
          reject(new Error("OAuth login timed out (5 minutes)"));
        },
        5 * 60 * 1000,
      );
      timeout.unref();
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
    return {
      accessToken,
      tokenType: data.token_type ?? "Bearer",
      expiresIn: data.expires_in ?? 2592000,
      expiresAt: Date.now() + (data.expires_in ?? 2592000) * 1000,
      userId: data.user_id ?? "",
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

  getBaseUrl(): string {
    return this.config.oauthTokenBaseUrl;
  }
}

export interface GateOAuthConfig extends BaseOAuthConfig {
  gateAuthEndpoint: string;
  clientId: string;
  scope: string;
}

/** 默认测试环境；生产请通过环境变量或构造参数覆盖 */
export const GATE_DEFAULT_CONFIG: GateOAuthConfig = {
  oauthTokenBaseUrl: "http://localhost",
  gateAuthEndpoint: "https://www.gate.com/oauth/authorize",
  clientId: "JWjvVeiJaePiTvQZ",
  scope: "fomox_login_info",
  callbackPort: 0,
};

function gateOAuthConfigFromEnv(): Partial<GateOAuthConfig> {
  const partial: Partial<GateOAuthConfig> = {};
  const base =
    process.env.GATE_PAY_OAUTH_TOKEN_BASE_URL?.trim() ||
    process.env.GATE_PAY_OAUTH_MCP_SERVER_URL?.trim();
  if (base) partial.oauthTokenBaseUrl = base;
  const auth = process.env.GATE_PAY_OAUTH_AUTHORIZE_URL?.trim();
  if (auth) partial.gateAuthEndpoint = auth;
  const cid = process.env.GATE_PAY_OAUTH_CLIENT_ID?.trim();
  if (cid) partial.clientId = cid;
  const scope = process.env.GATE_PAY_OAUTH_SCOPE?.trim();
  if (scope) partial.scope = scope;
  const portStr = process.env.GATE_PAY_OAUTH_CALLBACK_PORT?.trim();
  if (portStr) {
    const n = parseInt(portStr, 10);
    if (!Number.isNaN(n)) partial.callbackPort = n;
  }
  return partial;
}

export class GateOAuth extends BaseLocalOAuth<GateOAuthConfig> {
  constructor(config?: Partial<GateOAuthConfig>) {
    super({ ...GATE_DEFAULT_CONFIG, ...gateOAuthConfigFromEnv(), ...config });
  }

  protected buildAuthUrl(redirectUri: string): string {
    const url = new URL(this.config.gateAuthEndpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scope);
    return url.toString();
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthToken> {
    const base = this.config.oauthTokenBaseUrl.replace(/\/$/, "");
    const res = await fetch(
      `${base}/callback?code=${encodeURIComponent(code)}&redirect_url=${encodeURIComponent(redirectUri)}`,
    );

    if (!res.ok) {
      const altRes = await fetch(
        `${base}/account/user/gate_oauth?code=${encodeURIComponent(code)}`,
      );
      if (!altRes.ok) {
        throw new Error(
          `Token exchange failed: ${res.status} ${res.statusText}`,
        );
      }
      return this.parseTokenResponse(
        (await altRes.json()) as TokenExchangeResponse,
      );
    }

    return this.parseTokenResponse((await res.json()) as TokenExchangeResponse);
  }
}

async function loginWithGatePayOAuthRedirect(): Promise<GatePayDeviceFlowResult> {
  console.error(
    "[Gate Pay] 请在浏览器完成授权；成功后将回调本机，并由本地调用远程接口获取 access_token。",
  );
  try {
    const oauth = new GateOAuth();
    const token = await oauth.login();
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
