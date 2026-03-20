import { createPluginWalletSigner } from "./signers.js";
import {
  getPluginWalletClient,
  getPluginWalletServerUrl,
  type PluginWalletClient,
} from "../wallets/plugin-wallet-client.js";
import type {
  ResolveSignerContext,
  ResolvedSignerSession,
  SignModeAvailability,
  SignModeDefinition,
} from "./types.js";

export interface PluginWalletModeOptions {
  serverUrl?: string;
  clientFactory?: (serverUrl: string) => Promise<PluginWalletClient>;
}

export class PluginWalletMode implements SignModeDefinition {
  readonly id = "plugin_wallet" as const;
  readonly priority = 30;

  constructor(private readonly options: PluginWalletModeOptions = {}) {}

  async checkAvailability(): Promise<SignModeAvailability> {
    const serverUrl = this.getServerUrl();
    if (!serverUrl) {
      return {
        status: "not_configured",
        summary: "plugin_wallet 未配置或缺少 PLUGIN_WALLET_TOKEN。请前往插件钱包获取 token 并配置环境变量。",
        missing: ["PLUGIN_WALLET_TOKEN"],
      };
    }

    try {
      const client = await this.getClient(serverUrl);
      const statusResult = await client.walletStatus();
      console.log('statusResult', statusResult);
      const statusData = parseToolResult<Record<string, unknown>>(statusResult);
      if (isPluginWalletConnected(statusData)) {
        return {
          status: "ready",
          summary: "plugin_wallet 已连接可用浏览器钱包。",
        };
      }
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(`[plugin_wallet] checkAvailability failed: ${message}`);
    }

    return {
      status: "needs_login",
      summary: "plugin_wallet 需要先连接浏览器钱包。",
      missing: ["browser_wallet_connection"],
    };
  }

  async resolveSigner(context: ResolveSignerContext): Promise<ResolvedSignerSession> {
    void context;
    const serverUrl = this.getServerUrl();
    if (!serverUrl) {
      throw new Error("PLUGIN_WALLET_TOKEN is not set. 请前往插件钱包获取 token 并配置环境变量 PLUGIN_WALLET_TOKEN。");
    }

    const client = await this.getClient(serverUrl);
    
    // 每次都调用 connect_wallet 来唤醒浏览器插件，确保插件处于活跃状态
    const connectResult = await client.connectWallet();
    console.log("connectResult", connectResult);
    
    // 检查 MCP 返回的 isError 标志
    if (connectResult && typeof connectResult === "object" && "isError" in connectResult) {
      const mcpResult = connectResult as { isError?: boolean; content?: unknown[] };
      if (mcpResult.isError) {
        const data = parseToolResult<Record<string, unknown>>(connectResult);
        const errorMsg = data?.error;
        if (typeof errorMsg === "string") {
          // 用户拒绝连接
          if (errorMsg.includes("拒绝") || errorMsg.includes("reject")) {
            throw new Error(`无法连接浏览器钱包：${errorMsg}`);
          }
          throw new Error(`连接浏览器钱包失败：${errorMsg}`);
        }
        throw new Error("连接浏览器钱包失败：未知错误");
      }
    }
    
    const address = await this.resolveAddress(client, connectResult);

    return {
      signer: createPluginWalletSigner(client, address),
    };
  }

  getCacheKey(): string {
    return `${this.id}:${this.getServerUrl() ?? "missing-url"}`;
  }

  private getServerUrl(): string | undefined {
    const fromOptions = this.options.serverUrl?.trim();
    if (fromOptions) {
      return fromOptions;
    }

    return getPluginWalletServerUrl();
  }

  private async getClient(serverUrl: string): Promise<PluginWalletClient> {
    if (this.options.clientFactory) {
      return this.options.clientFactory(serverUrl);
    }

    return getPluginWalletClient({ serverUrl });
  }


  private async resolveAddress(
    client: PluginWalletClient,
    connectResult: unknown,
  ): Promise<`0x${string}`> {
    const connectData = parseToolResult<Record<string, unknown>>(connectResult);
    const connectedAddress = extractEvmAddress(connectData);
    if (connectedAddress) {
      return connectedAddress;
    }

    const accountsResult = await client.getAccounts();
    const accountsData = parseToolResult<Record<string, unknown>>(accountsResult);
    const accountAddress = extractEvmAddress(accountsData);
    if (accountAddress) {
      return accountAddress;
    }

    const hint = getExtensionHint(connectData) ?? getExtensionHint(accountsData)
      ?? "请先在浏览器中打开 Gate Wallet 扩展并连接，或打开与插件钱包同会话的页面后再重试。";
    throw new Error(`plugin_wallet 未获取到 EVM 地址。${hint}`);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 从 MCP 返回里取出与「扩展未连接」相关的提示，用于抛错时附带说明。 */
function getExtensionHint(data: Record<string, unknown> | null): string | null {
  if (!data || typeof data.error !== "string") return null;
  const msg = data.error.trim();
  if (!msg) return null;
  return msg.includes("扩展") || msg.includes("extension") || msg.includes("连接") || msg.includes("拒绝") || msg.includes("reject")
    ? ` ${msg}`
    : null;
}

function parseToolResult<T = Record<string, unknown>>(result: unknown): T | null {
  if (result == null || typeof result !== "object" || !("content" in result)) {
    return null;
  }

  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  const first = content[0] as { type?: string; text?: string } | undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    return null;
  }

  try {
    let parsed: unknown = JSON.parse(first.text);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function isPluginWalletConnected(data: Record<string, unknown> | null): boolean {
  if (!data) {
    return false;
  }

  if (typeof data.connected === "boolean") {
    return data.connected;
  }

  return extractEvmAddress(data) !== null;
}

function extractEvmAddress(data: Record<string, unknown> | null): `0x${string}` | null {
  if (!data) {
    return null;
  }

  const candidates: unknown[] = [];
  if (typeof data.address === "string") {
    candidates.push(data.address);
  }

  if (Array.isArray(data.accounts)) {
    candidates.push(...data.accounts);
  }

  if (Array.isArray(data.addresses)) {
    candidates.push(...data.addresses);
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^0x[a-fA-F0-9]{40}$/.test(candidate)) {
      return candidate as `0x${string}`;
    }
  }

  return null;
}
