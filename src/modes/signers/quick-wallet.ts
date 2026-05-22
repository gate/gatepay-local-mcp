import { base58 } from "@scure/base";
import {
  hashMessage,
  serializeTransaction,
  type Hex,
  type SignableMessage,
  type TransactionSerializable,
} from "viem";
import type { ClientEvmSigner, ClientSvmSigner } from "../../x402/types.js";
import type { GateMcpClient } from "../../wallets/wallet-mcp-clients.js";
import { buildEip712TypedDataDigest } from "../../x402/utils.js";
import {
  parseMcpToolResult,
  extractSignatureFromMcpResult,
  extractQuickWalletSolanaSignature,
  extractSignedEvmRawTransactionHex,
  getBase58EncodedWireTransaction,
} from "./shared-utils.js";
import { txCheckin } from "../tx-checkin/checkin.js";
import { recordTrackingWalletAddress } from "../../tracking/tracking-invocation-context.js";

/**
 * 通过 txCheckin 获取 checkin_token
 */
async function getCheckinToken(
  mcp: GateMcpClient,
  walletAddress: string,
  chain: string,
  chainCategory: string,
  checkinParams: { message?: string; intent?: string },
): Promise<string> {
  const mcpToken = mcp.getMcpToken();
  if (!mcpToken) throw new Error("getCheckinToken: mcp token not available");

  const result = await txCheckin({
    mcpToken,
    walletAddress,
    chain,
    chainCategory,
    ...checkinParams,
  });

  if (!result.checkin_token) throw new Error("getCheckinToken: no checkin_token in response");
  return result.checkin_token;
}

export interface CreateQuickWalletSignerOptions {
  evmAddress?: `0x${string}`;
  /** 未设置 gateMcpEvmChain 时用于 dex_wallet_sign_message（默认 ETH） */
  chain?: string;
  /**
   * Gate MCP 链标识（如 BASE），与 {@link evmChainId} 一起用于 MPP：`dex_wallet_sign_transaction` + checkin。
   */
  gateMcpEvmChain?: string;
  /** 如 8453 / 84532；传入后启用链上交易签名（viem writeContract） */
  evmChainId?: number;
}

/**
 * 创建快速托管钱包 Signer (用于 quick_wallet 签名模式)
 */
export async function createQuickWalletSigner(
  mcp: GateMcpClient,
  options?: CreateQuickWalletSignerOptions,
): Promise<ClientEvmSigner> {
  let address: `0x${string}`;
  if (options?.evmAddress) {
    address = options.evmAddress;
  } else {
    const addrResult = await mcp.walletGetAddresses();
    const data = parseMcpToolResult<{ addresses?: Record<string, string> }>(addrResult);
    const evm = data?.addresses?.EVM;
    if (!evm || !evm.startsWith("0x")) {
      throw new Error(
        "createQuickWalletSigner: no EVM address in wallet.get_addresses response",
      );
    }
    address = evm as `0x${string}`;
  }

  recordTrackingWalletAddress(address);

  const mcpChain =
    options?.gateMcpEvmChain?.trim() || options?.chain?.trim() || "ETH";
  const evmChainIdOpt = options?.evmChainId;
  const txMcpChain = options?.gateMcpEvmChain?.trim() || "BASE";

  const signDigest = async (digest: `0x${string}`, intent?: string): Promise<`0x${string}`> => {
    const digestForMcp = digest.replace(/^0x/i, "");
    const checkinToken = await getCheckinToken(mcp, address, mcpChain, "evm", { message: intent });
    const result = await mcp.walletSignMessage("EVM", digestForMcp, checkinToken);
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
        "createQuickWalletSigner: wallet.sign_message(digest) did not return a signature",
      );
    }
    return sig;
  };

  const signTypedData = async (msg: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    intent?: string;
  }): Promise<`0x${string}`> => {
    const digest = buildEip712TypedDataDigest(msg as Parameters<typeof buildEip712TypedDataDigest>[0]);
    const digestForMcp = digest.replace(/^0x/i, "");
    console.error("[createSignerFromMcpWallet] typedData digest:", digestForMcp);
    
    const checkinToken = await getCheckinToken(mcp, address, mcpChain, "evm", {
      message: digestForMcp,
    });
    const result = await mcp.walletSignMessage("EVM", digestForMcp, checkinToken);

    const data = parseMcpToolResult<Record<string, unknown>>(result);
    const sig = data && extractSignatureFromMcpResult(data);
    let normalizedSig = sig;
    if (sig && /^0x[0-9a-fA-F]{130}$/.test(sig)) {
      const vHex = sig.slice(130, 132);
      const v = Number.parseInt(vHex, 16);
      if (v === 0 || v === 1) {
        const normalizedV = (v + 27).toString(16).padStart(2, "0");
        normalizedSig = `${sig.slice(0, 130)}${normalizedV}` as `0x${string}`;
      }
    }
    console.error("[createSignerFromMcpWallet] sig:", normalizedSig);

    if (!sig) {
      throw new Error(
        "createSignerFromMcpWallet: wallet.sign_message(typedData digest) did not return a signature",
      );
    }
    return normalizedSig as `0x${string}`;
  };

  async function signMessage({ message }: { message: SignableMessage }): Promise<Hex> {
    const hashed = hashMessage(message);
    return signDigest(hashed as `0x${string}`, hashed.replace(/^0x/i, ""));
  }

  async function signTransaction(
    transaction: TransactionSerializable,
    opts?: { serializer?: typeof serializeTransaction },
  ): Promise<Hex> {
    if (evmChainIdOpt == null) {
      throw new Error(
        "createQuickWalletSigner: pass evmChainId (and gateMcpEvmChain, e.g. BASE) to enable EVM signTransaction for MPP chain writes."
      );
    }
    const serializer = opts?.serializer ?? serializeTransaction;
    const signableTransaction =
      transaction.type === "eip4844"
        ? { ...transaction, sidecars: false as const }
        : transaction;
    const unsignedSerialized = serializer(signableTransaction as never) as Hex;
    const txBundle = {
      tx: unsignedSerialized,
      category: "EVM",
      enc: "",
      network: { chainId: 0 },
      type: "",
    };
    console.error("[createQuickWalletSigner] rawHexNo0x:", unsignedSerialized);
    const checkinToken = await getCheckinToken(mcp, address, "evm", txMcpChain, {
      message: JSON.stringify(txBundle),
    });
    const result = await mcp.walletSignTransaction(
      txMcpChain,
      { raw_tx: unsignedSerialized },
      checkinToken,
    );
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    if (!data) {
      throw new Error("createQuickWalletSigner: walletSignTransaction returned empty MCP payload");
    }
    const signed = extractSignedEvmRawTransactionHex(data);
    if (!signed) {
      throw new Error(
        `createQuickWalletSigner: could not parse signed raw tx from dex_wallet_sign_transaction (keys: ${Object.keys(data).join(", ")})`
      );
    }
    return signed;
  }

  return {
    address,
    signTypedData,
    signDigest,
    signMessage,
    signTransaction,
  };
}

export const createSignerFromMcpWallet = createQuickWalletSigner;

/**
 * 创建快速托管钱包 Solana Signer (用于 quick_wallet 签名模式的 Solana 网络)
 */
export async function createQuickWalletSolanaSigner(
  mcp: GateMcpClient,
  options?: { solAddress?: string },
): Promise<ClientSvmSigner> {
  let address: string;
  if (options?.solAddress) {
    address = options.solAddress;
  } else {
    const addrResult = await mcp.walletGetAddresses();
    const data = parseMcpToolResult<{ addresses?: Record<string, string> }>(addrResult);
    const sol = data?.addresses?.SOL;
    if (!sol) {
      throw new Error(
        "createQuickWalletSolanaSigner: no SOL address in wallet.get_addresses response",
      );
    }
    address = sol;
    console.error("createQuickWalletSolanaSigner address", address);
  }

  const { address: createAddress } = await import("@solana/addresses");
  const { signatureBytes: createSignatureBytes } = await import("@solana/keys");
  const { getTransactionEncoder } = await import("@solana/transactions");
  
  const solAddress = createAddress(address);
  
  const transactionEncoder = getTransactionEncoder();

  return {
    address: solAddress,
    signTransactions: async (transactions, config) => {
      void config;
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        const transactionBase58 = getBase58EncodedWireTransaction(transaction, transactionEncoder);
        console.error("[quick-wallet-solana] 交易 Base58 长度:", transactionBase58.length);

        const txBundle = {
          tx: transactionBase58,
          category: "SOL",
          enc: "",
          network: { chainId: 0 },
          type: "",
        }
        const checkinToken = await getCheckinToken(mcp, address, "SOL", "solana", { message: JSON.stringify(txBundle) });
        const result = await mcp.walletSignTransaction("SOL", {
          raw_tx: transactionBase58,
        }, checkinToken);
        
        if (!result || typeof result !== "object" || !("content" in result)) {
          throw new Error("签名失败：未返回有效结果");
        }
        
        const content = (result as { content?: unknown[] }).content;
        const firstItem = Array.isArray(content)
          ? (content[0] as { type?: string; text?: string } | undefined)
          : undefined;
        
        if (!firstItem || firstItem.type !== "text" || typeof firstItem.text !== "string") {
          throw new Error("签名失败：返回格式无效");
        }
        
        let data: unknown;
        try {
          data = JSON.parse(firstItem.text);
        } catch {
          throw new Error("签名失败：返回数据不是有效的 JSON");
        }
        
        if (!data || typeof data !== "object") {
          throw new Error("签名失败：返回数据不是有效的对象");
        }
        
        const signatureInfo = extractQuickWalletSolanaSignature(data as Record<string, unknown>);
        
        if (!signatureInfo) {
          throw new Error("签名失败：无法从返回数据中提取签名");
        }
        
        console.error("[quick-wallet-solana] 签名提取成功:", signatureInfo.signatureBase58);
        
        const signatureBytesArray = base58.decode(signatureInfo.signatureBase58);
        const signature = createSignatureBytes(signatureBytesArray);
        
        const signatureDictionary = {
          [solAddress]: signature,
        };
        
        signatureDictionaries.push(signatureDictionary);
      }
      
      return signatureDictionaries;
    },
  } as ClientSvmSigner;
}
