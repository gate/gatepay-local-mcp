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
import type { ClientEvmSigner } from "../x402/types.js";

/** 未解析 EVM 时的占位签名器；调用 signTypedData / signDigest 会抛错 */
function createDisabledPluginEvmSigner(): ClientEvmSigner {
  const disabled = (): Promise<`0x${string}`> =>
    Promise.reject(
      new Error(
        "plugin_wallet: EVM 签名器已禁用（resolveEvmSigner 未使用），请使用 solanaSigner 或恢复 EVM 解析",
      ),
    );
  return {
    address: "0x0000000000000000000000000000000000000000",
    signTypedData: disabled,
    signDigest: disabled,
  };
}

export interface PluginWalletModeOptions {
  serverUrl?: string;
  clientFactory?: (serverUrl: string) => Promise<PluginWalletClient>;
}

interface EvmConnectCache {
  connectResult: unknown;
}

interface SolanaConnectCache {
  connectResult: unknown;
}

export class PluginWalletMode implements SignModeDefinition {
  readonly id = "plugin_wallet" as const;
  readonly priority = 30;
  
  // EVM 连接结果缓存，避免重复弹窗
  private evmConnectCache: Map<string, EvmConnectCache> = new Map();
  
  // Solana 连接结果缓存，避免重复弹窗
  private solanaConnectCache: Map<string, SolanaConnectCache> = new Map();

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
    
    // 解析 EVM 签名器
    const evmSigner = await this.resolveEvmSigner(client);
    
    // 解析 Solana 签名器（可选，失败不影响 EVM）
    const solanaSigner = await this.resolveSolanaSigner(client);

    return {
      signer: createPluginWalletSigner(client, evmSigner.address),
      solanaSigner,
    };
  }

  /**
   * 解析 EVM 签名器
   */
  private async resolveEvmSigner(
    client: PluginWalletClient,
  ): Promise<{ signer: ReturnType<typeof createPluginWalletSigner>; address: `0x${string}` }> {
    // 先尝试从缓存中获取已连接的地址
    let connectResult: unknown;
    let cachedAddress: `0x${string}` | undefined;
    
    // 检查是否有任何缓存的连接
    for (const [addr, cache] of this.evmConnectCache.entries()) {
      cachedAddress = addr as `0x${string}`;
      connectResult = cache.connectResult;
      console.log('✓ 使用缓存的 EVM 连接结果');
      break; // 只使用第一个缓存（通常只有一个）
    }
    
    // 如果没有缓存，调用 connect_wallet
    if (!connectResult) {
      console.log('调用 connect_wallet 获取 EVM 授权');
      connectResult = await client.connectWallet();
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
    }
    
    // 解析地址
    const address = await this.resolveAddress(client, connectResult);
    
    // 检查地址是否变化
    if (cachedAddress && cachedAddress !== address) {
      console.log('⚠️  检测到 EVM 地址变化，清空所有缓存');
      this.evmConnectCache.clear();
      this.solanaConnectCache.clear();
    }
    
    // 保存缓存
    this.evmConnectCache.set(address, { connectResult });
    console.log('✓ EVM 连接结果已缓存');
    
    const signer = createPluginWalletSigner(client, address);

    return { signer, address };
  }

  /**
   * 解析 Solana 签名器（可选，失败不影响 EVM 签名器）
   */
  private async resolveSolanaSigner(
    client: PluginWalletClient,
  ): Promise<ReturnType<typeof import("./signers.js").createPluginWalletSolanaSigner> | undefined> {
    try {
      // 先尝试从缓存中获取已连接的地址和结果
      let solConnectResult: unknown;
      let cachedAddress: string | undefined;
      
      // 检查是否有任何缓存的连接
      for (const [addr, cache] of this.solanaConnectCache.entries()) {
        cachedAddress = addr;
        solConnectResult = cache.connectResult;
        console.log('✓ 使用缓存的 Solana 连接结果');
        break; // 只使用第一个缓存（通常只有一个）
      }
      
      // 如果没有缓存，调用 sol_connect_wallet
      if (!solConnectResult) {
        console.log('调用 sol_connect_wallet 获取 Solana 授权');
        solConnectResult = await client.solConnectWallet();
        console.log('solConnectWallet result:', solConnectResult);
        
        // 检查 MCP 返回的 isError 标志
        if (solConnectResult && typeof solConnectResult === "object" && "isError" in solConnectResult) {
          const mcpResult = solConnectResult as { isError?: boolean; content?: unknown[] };
          if (mcpResult.isError) {
            const data = parseToolResult<Record<string, unknown>>(solConnectResult);
            const errorMsg = data?.error;
            if (typeof errorMsg === "string") {
              // 用户拒绝 Solana 连接
              if (errorMsg.includes("拒绝") || errorMsg.includes("reject")) {
                throw new Error(`用户拒绝了 Solana 连接：${errorMsg}`);
              }
              throw new Error(`Solana 连接失败：${errorMsg}`);
            }
            throw new Error("Solana 连接失败：未知错误");
          }
        }
      }
      
      // 获取 Solana 地址
      const solanaAddress = await this.resolveSolanaAddress(client, solConnectResult);
      console.log('resolveSolanaAddress:', solanaAddress);
      
      if (!solanaAddress) {
        console.log('未获取到 Solana 地址');
        return undefined;
      }

      // 检查地址是否变化
      if (cachedAddress && cachedAddress !== solanaAddress) {
        console.log('⚠️  检测到 Solana 地址变化，清空 Solana 缓存');
        this.solanaConnectCache.clear();
        // 地址变化了，需要重新连接
        throw new Error('Solana 地址已变化，需要重新连接');
      }

      // 创建 Solana 签名器
      const { createPluginWalletSolanaSigner } = await import("./signers.js");
      const solanaSigner = await createPluginWalletSolanaSigner(client, solanaAddress);
      
      // 签名器创建成功，保存缓存（使用 Solana 地址作为 key）
      this.solanaConnectCache.set(solanaAddress, { connectResult: solConnectResult });
      console.log('✓ Solana 连接结果已缓存');

      return solanaSigner;
    } catch (error) {
      // Solana 地址获取失败或签名器创建失败，清空缓存
      this.solanaConnectCache.clear();
      console.warn("⚠️  未能获取 Solana 地址，将仅使用 EVM 签名器:", error);
      return undefined;
    }
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

  private async resolveSolanaAddress(
    client: PluginWalletClient,
    connectResult: unknown,
  ): Promise<string | null> {
    // 首先尝试从 connectResult 中提取
    const connectData = parseToolResult<Record<string, unknown>>(connectResult);
    const connectedAddress = extractSolanaAddress(connectData);
    if (connectedAddress) {
      return connectedAddress;
    }

    // 如果 connectResult 中没有，调用 sol_get_accounts 获取
    try {
      const accountsResult = await client.solGetAccounts();
      const accountsData = parseToolResult<Record<string, unknown>>(accountsResult);
      const accountAddress = extractSolanaAddress(accountsData);
      if (accountAddress) {
        return accountAddress;
      }
    } catch (error) {
      console.warn("⚠️  调用 sol_get_accounts 失败:", error);
    }

    return null;
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

function extractSolanaAddress(data: Record<string, unknown> | null): string | null {
  if (!data) {
    return null;
  }

  
  // 首先检查 account 字段（插件钱包的常见返回格式）
  if (typeof data.account === "string" && data.account.length > 0) {
    return data.account;
  }

  // Solana 地址通常在 solanaAddress 或 solana 字段
  if (typeof data.solanaAddress === "string" && data.solanaAddress.length > 0) {
    return data.solanaAddress;
  }

  if (typeof data.solana === "string" && data.solana.length > 0) {
    return data.solana;
  }

  // 检查 addresses 对象中的 Solana 地址
  if (data.addresses && typeof data.addresses === "object") {
    const addresses = data.addresses as Record<string, unknown>;
    if (typeof addresses.solana === "string" && addresses.solana.length > 0) {
      return addresses.solana;
    }
    if (typeof addresses.SOL === "string" && addresses.SOL.length > 0) {
      return addresses.SOL;
    }
  }

  return null;
}
