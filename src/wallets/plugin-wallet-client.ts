import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface PluginWalletClient {
  walletStatus(): Promise<unknown>;
  connectWallet(): Promise<unknown>;
  getAccounts(): Promise<unknown>;
  /** 签 EIP-712：typedData 为 4 字段 JSON 字符串（types、primaryType、domain、message） */
  signTypedData(typedDataJson: string, address: string): Promise<unknown>;
  /** 签原始 digest（部分钱包仅支持 signTypedData，此路径可能不被支持） */
  signMessage(message: string, address: string): Promise<unknown>;
  /** 切换钱包当前连接的区块链网络 */
  switchChain(chainId: string): Promise<unknown>;
  
  // Solana 相关方法
  /** 连接 Solana 钱包账户，获取用户授权和公钥地址 */
  solConnectWallet(): Promise<unknown>;
  /** 获取当前已连接的 Solana 钱包账户地址 */
  solGetAccounts(): Promise<unknown>;
  /** 使用 Solana 钱包对消息进行签名 */
  solSignMessage(message: string, authPayload: string): Promise<unknown>;
  /** 对一笔 Solana 交易进行签名（不发送） */
  solSignTransaction(transaction: string): Promise<unknown>;
}

export interface PluginWalletClientConfig {
  serverUrl: string;
}

let instance: BrowserWalletMcpClient | null = null;
let instanceUrl: string | null = null;

export function getPluginWalletServerUrl(): string | undefined {
  const baseUrl = process.env.PLUGIN_WALLET_SERVER_URL?.trim();
  const token = process.env.PLUGIN_WALLET_TOKEN?.trim();
  
  if (!baseUrl || !token) {
    return undefined;
  }
  
  return `${baseUrl}?token=${encodeURIComponent(token)}`;
}

export async function getPluginWalletClient(
  config?: Partial<PluginWalletClientConfig>,
): Promise<PluginWalletClient> {
  const serverUrl = config?.serverUrl?.trim() || getPluginWalletServerUrl();
  if (!serverUrl) {
    throw new Error("PLUGIN_WALLET_TOKEN is not set. 请前往插件钱包获取 token 并配置环境变量 PLUGIN_WALLET_TOKEN。");
  }

  if (instance?.isConnected() && instanceUrl === serverUrl) {
    return instance;
  }

  if (instance) {
    await instance.disconnect();
  }

  instance = new BrowserWalletMcpClient({ serverUrl });
  instanceUrl = serverUrl;
  await instance.connect();
  return instance;
}

class BrowserWalletMcpClient implements PluginWalletClient {
  private client: Client | null = null;

  constructor(private readonly config: PluginWalletClientConfig) {}

  async connect(): Promise<void> {
    const url = new URL(this.config.serverUrl);
    console.error(`[PluginWallet] connect: url=${url.href}`);

    const transport = new StreamableHTTPClientTransport(url);
    this.client = new Client({
      name: "gate-pay-plugin-wallet-client",
      version: "1.0.0",
    });

    await this.client.connect(transport);
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.close();
    this.client = null;
  }

  async walletStatus(): Promise<unknown> {
    return this.callTool("wallet_status");
  }

  async connectWallet(): Promise<unknown> {
    return this.callTool("connect_wallet");
  }

  async getAccounts(): Promise<unknown> {
    return this.callTool("get_accounts");
  }

  async signTypedData(typedDataJson: string, address: string): Promise<unknown> {
    // 传递 authPayload = pay, 用于标识这个stdio
    return this.callTool("sign_message", {
      typedData: typedDataJson,
      address,
      authPayload: "pay",
    });
  }

  async signMessage(message: string, address: string): Promise<unknown> {
    return this.callTool("sign_message", {
      typedData: message,
      address,
    });
  }

  async switchChain(chainId: string): Promise<unknown> {
    return this.callTool("switch_chain", {
      chainId,
    });
  }

  async solConnectWallet(): Promise<unknown> {
    return this.callTool("sol_connect_wallet");
  }

  async solGetAccounts(): Promise<unknown> {
    return this.callTool("sol_get_accounts");
  }

  async solSignMessage(message: string, authPayload: string): Promise<unknown> {
    return this.callTool("sol_sign_message", {
      message,
      authPayload,
    });
  }

  async solSignTransaction(transaction: string): Promise<unknown> {
    return this.callTool("sol_sign_transaction", {
      transaction,
    });
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  private async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.ensureConnected();
    console.error(`[PluginWallet] callTool in: name=${name} arguments=${JSON.stringify(args)}`);
    const result = await this.client!.callTool({ name, arguments: args });
    console.error(`[PluginWallet] callTool out: name=${name} result=${JSON.stringify(result)}`);
    return result;
  }

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error("Plugin wallet MCP client not connected. Call connect() first.");
    }
  }
}
