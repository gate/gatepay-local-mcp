import { createServer, type Server } from "node:http";
import { ERROR_HTML, SUCCESS_HTML } from "./oauth-html.js";
import { logGatePayOAuth } from "./oauth-log.js";
import { openBrowser } from "./oauth-browser.js";
import type { BaseOAuthConfig, OAuthToken } from "./oauth-types.js";
import {
  bearerTokenFromExchangeJson,
  type TokenExchangeResponse,
} from "./oauth-token-exchange.js";

export abstract class BaseLocalOAuth<C extends BaseOAuthConfig> {
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
        callbackPort = (server.address() as { port: number }).port;
        const redirectUri = `http://localhost:${callbackPort}/callback`;
        logGatePayOAuth("本地回调监听已就绪（参数）", {
          host: "127.0.0.1",
          port: callbackPort,
          redirect_uri: redirectUri,
          configured_callbackPort: this.config.callbackPort,
        });

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
    const refreshToken =
      typeof data.refresh_token === "string" && data.refresh_token
        ? data.refresh_token
        : undefined;
    const rti = data.refresh_token_expires_in;
    const refreshTokenExpiresAt =
      typeof rti === "number" && rti > 0
        ? Date.now() + rti * 1000
        : undefined;
    return {
      accessToken,
      tokenType: data.token_type ?? "Bearer",
      expiresIn: ttlSec,
      expiresAt: Date.now() + ttlSec * 1000,
      userId: data.user_id ?? (data.uid != null ? String(data.uid) : ""),
      walletAddress: data.wallet_address,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      ...(refreshTokenExpiresAt !== undefined
        ? { refreshTokenExpiresAt }
        : {}),
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
