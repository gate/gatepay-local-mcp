/**
 * MCP Client 单例 - 连接远程 MCP Server
 * 两种钱包模式共用：
 *   - 本地钱包：查余额、查 gas、广播交易
 *   - 托管钱包：以上 + 服务端签名 (需 mcp_token)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpClientConfig {
  serverUrl: string;
  apiKey?: string;
}

const DEFAULT_SERVER_URL = "https://api.gatemcp.ai/mcp/dex";

export function getServerUrl(): string {
  return process.env["QUICK_WALLET_SERVER_URL"] ?? DEFAULT_SERVER_URL;
}

const DEFAULT_API_KEY = "MCP_AK_8W2N7Q";

export function getApiKey(): string | undefined {
  return process.env["QUICK_WALLET_API_KEY"] ?? DEFAULT_API_KEY;
}

const DEFAULT_CONFIG: McpClientConfig = {
  get serverUrl() {
    return getServerUrl();
  },
  get apiKey() {
    return getApiKey();
  },
};

const SENSITIVE_KEYS = new Set(["mcp_token", "access_token", "code", "message"]);

/** 在到期前提前视为过期，避免临界时刻请求失败 */
const MCP_TOKEN_EXPIRY_SKEW_MS = 60_000;

function maskSensitiveArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(k) && typeof v === "string") {
      out[k] = v.length > 8 ? `${v.slice(0, 4)}...${v.slice(-2)}` : "***";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function summarizeToolResult(result: unknown): string {
  if (result == null) return "result=null";
  if (typeof result !== "object" || !("content" in result)) return "result=(no content)";
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "result=(invalid content)";
  const item = content[0] as { type?: string; text?: string } | undefined;
  if (item && typeof item.text === "string") {
    const preview = item.text.length > 1200 ? `${item.text.slice(0, 1200)}...` : item.text;
    return `content[0].text=${JSON.stringify(preview)}`;
  }
  return `content.length=${content.length}`;
}

// ─── 单例 ───────────────────────────────────────────────

let instance: GateMcpClient | null = null;

/**
 * 获取 MCP Client 单例，首次调用时自动连接
 */
export async function getMcpClient(
  config?: Partial<McpClientConfig>,
): Promise<GateMcpClient> {
  if (instance?.isConnected()) {
    return instance;
  }
  instance = new GateMcpClient(config);
  await instance.connect();
  return instance;
}

/**
 * 获取已存在的 MCP Client（不自动连接）
 */
export function getMcpClientSync(): GateMcpClient | null {
  return instance?.isConnected() ? instance : null;
}

// ─── Client 类 ──────────────────────────────────────────

export class GateMcpClient {
  private client: Client | null = null;
  private config: McpClientConfig;
  private mcpToken: string | null = null;
  /** 绝对时间戳（ms），到期后需重新登录；null 表示未提供过期时间（仅不按时间失效） */
  private mcpTokenExpiresAtMs: number | null = null;

  constructor(config?: Partial<McpClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async connect(): Promise<void> {
    const url = new URL(this.config.serverUrl);
    const apiKey = this.config.apiKey ?? "MCP_AK_8W2N7Q";
    console.error(`[MCP] connect: url=${url.href} hasApiKey=${Boolean(apiKey)}`);

    const mcpFetch: typeof fetch = async (input, init) => {
      this.invalidateMcpTokenIfExpired();
      const headers = new Headers(init?.headers);
      if (apiKey) headers.set("x-api-key", apiKey);
      if (this.mcpToken) {
        headers.set("Authorization", `Bearer ${this.mcpToken}`);
      }
      return fetch(input, { ...init, headers });
    };

    const transport = new StreamableHTTPClientTransport(url, {
      fetch: mcpFetch,
    });

    this.client = new Client({
      name: "gate-pay-mcp-cli",
      version: "1.0.0",
    });

    await this.client.connect(transport);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // ─── Token 管理（托管钱包认证后设置）────────────────────

  /**
   * @param expiresAtMs 绝对过期时间（毫秒时间戳）。不传或传 null 表示不按时间失效（仅内存丢失或 clear 后需重登）。
   */
  setMcpToken(token: string, expiresAtMs?: number | null): void {
    this.mcpToken = token;
    this.mcpTokenExpiresAtMs =
      expiresAtMs === undefined || expiresAtMs === null ? null : expiresAtMs;
  }

  private invalidateMcpTokenIfExpired(): void {
    if (!this.mcpToken) return;
    if (this.mcpTokenExpiresAtMs == null) return;
    if (Date.now() >= this.mcpTokenExpiresAtMs - MCP_TOKEN_EXPIRY_SKEW_MS) {
      this.clearMcpToken();
    }
  }

  /**
   * 当前是否持有未过期（或未配置过期）的 MCP token，供 quick_wallet 等判断是否需设备流重登。
   */
  isMcpTokenUsable(): boolean {
    this.invalidateMcpTokenIfExpired();
    return this.mcpToken !== null;
  }

  getMcpToken(): string | null {
    this.invalidateMcpTokenIfExpired();
    return this.mcpToken;
  }

  clearMcpToken(): void {
    this.mcpToken = null;
    this.mcpTokenExpiresAtMs = null;
  }

  // ─── 认证 Tools（托管钱包用）──────────────────────────

  async authGateLoginStart() {
    return this.callTool("dex_auth_gate_login_start");
  }

  async authGateLoginPoll(flowId: string) {
    return this.callTool("dex_auth_gate_login_poll", { flow_id: flowId });
  }

  async authGoogleLoginStart() {
    return this.callTool("dex_auth_google_login_start");
  }

  async authGoogleLoginPoll(flowId: string) {
    return this.callTool("dex_auth_google_login_poll", { flow_id: flowId });
  }

  /**
   * 通过 auth code + redirect_uri 直接登录（本地回调模式使用）
   */
  async authLoginWithCode(
    provider: "gate" | "google",
    code: string,
    redirectUrl: string,
  ) {
    const tool =
      provider === "google"
        ? "auth.login_google_wallet"
        : "auth.login_gate_wallet";
    return this.callTool(tool, { code, redirect_url: redirectUrl });
  }

  getServerBaseUrl(): string {
    return this.config.serverUrl.replace(/\/mcp$/, "");
  }

  async authLogout() {
    if (!this.mcpToken) return;
    const result = await this.callTool("dex_auth_logout", {
      mcp_token: this.mcpToken,
    });
    this.clearMcpToken();
    return result;
  }

  // ─── 通用 Tool 调用 ──────────────────────────────────

  async listTools() {
    this.ensureConnected();
    return this.client!.listTools();
  }

  /**
   * 调用 MCP Tool，已登录时自动注入 mcp_token
   */
  async callTool(name: string, args: Record<string, unknown> = {}) {
    this.ensureConnected();
    this.invalidateMcpTokenIfExpired();
    const finalArgs =
      this.mcpToken && !args["mcp_token"]
        ? { ...args, mcp_token: this.mcpToken }
        : args;
    const logArgs = maskSensitiveArgs(finalArgs);
    console.error(`[MCP] callTool in: name=${name} arguments=${JSON.stringify(logArgs)}`);
    const result = await this.client!.callTool({ name, arguments: finalArgs });
    const logOut = summarizeToolResult(result);
    console.error(`[MCP] callTool out: name=${name} ${logOut}`);
    return result;
  }

  // ─── 链上查询（两种钱包模式共用）──────────────────────

  async chainConfig(chain: string) {
    return this.callTool("chain.config", { chain });
  }

  async txGas(chain: string) {
    return this.callTool("tx.gas", { chain });
  }

  async txSendRaw(chain: string, rawTx: string) {
    return this.callTool("tx.send_raw_transaction", {
      chain,
      raw_transaction: rawTx,
    });
  }

  async txTransferPreview(params: Record<string, unknown>) {
    return this.callTool("tx.transfer_preview", params);
  }

  async txQuote(params: Record<string, unknown>) {
    return this.callTool("tx.quote", params);
  }

  async txSwap(params: Record<string, unknown>) {
    return this.callTool("tx.swap", params);
  }

  async txHistory(params: Record<string, unknown>) {
    return this.callTool("tx.history_list", params);
  }

  async txDetail(params: Record<string, unknown>) {
    return this.callTool("tx.detail", params);
  }

  // ─── 托管钱包操作（需 mcp_token）─────────────────────

  async walletGetAddresses() {
    return this.callTool("dex_wallet_get_addresses");
  }

  async walletGetTokenList(chain?: string) {
    return this.callTool("dex_wallet_get_token_list", chain ? { chain } : {});
  }

  async walletGetTotalAsset() {
    return this.callTool("dex_wallet_get_total_asset");
  }

  async walletSignMessage(chain: string, message: string,checkin_token:string) {
    return this.callTool("dex_wallet_sign_message", { chain, message, checkin_token });
  }

  async walletSignTransaction(chain: string, txData: Record<string, unknown>, checkin_token:string) {
    return this.callTool("dex_wallet_sign_transaction", { chain, ...txData, checkin_token });
  }

  // ─── 市场数据（公开，无需认证）───────────────────────

  async tokenGetCoinInfo(params: Record<string, unknown>) {
    return this.callTool("token_get_coin_info", params);
  }

  async tokenRanking(params: Record<string, unknown>) {
    return this.callTool("token_ranking", params);
  }

  // ─── 内部方法 ─────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error("MCP client not connected. Call connect() first.");
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  isAuthenticated(): boolean {
    return this.isMcpTokenUsable();
  }
}
