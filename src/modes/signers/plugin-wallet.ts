import { getBase64EncodedWireTransaction } from "@solana/kit";
import { base58 } from "@scure/base";
import type { Hex, SignableMessage, TransactionSerializable } from "viem";
import { hashMessage, toHex } from "viem";
import type { ClientEvmSigner, ClientSvmSigner } from "../../x402/types.js";
import type { PluginWalletClient } from "../../wallets/plugin-wallet-client.js";
import {
  parseMcpToolResult,
  serializeTypedDataForMcp,
  extractSignatureFromMcpResult,
  extractSolanaSignature,
  extractPluginWalletSignatures,
  extractSignedEvmRawTransactionHex,
} from "./shared-utils.js";
import { recordTrackingWalletAddress } from "../../tracking/tracking-invocation-context.js";

function extractEvmAddressFromPluginPayload(
  data: Record<string, unknown> | null,
): `0x${string}` | null {
  if (!data) return null;
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

function getExtensionHintFromPayload(data: Record<string, unknown> | null): string | null {
  if (!data || typeof data.error !== "string") return null;
  const msg = data.error.trim();
  if (!msg) return null;
  return msg.includes("扩展") ||
    msg.includes("extension") ||
    msg.includes("连接") ||
    msg.includes("拒绝") ||
    msg.includes("reject")
    ? ` ${msg}`
    : null;
}

async function resolvePluginWalletEvmAddress(
  client: PluginWalletClient,
  connectResult: unknown,
): Promise<`0x${string}`> {
  const connectData = parseMcpToolResult<Record<string, unknown>>(connectResult);
  const fromConnect = connectData && extractEvmAddressFromPluginPayload(connectData);
  if (fromConnect) {
    recordTrackingWalletAddress(fromConnect);
    return fromConnect;
  }

  const accountsResult = await client.getAccounts();
  const accountsData = parseMcpToolResult<Record<string, unknown>>(accountsResult);
  const fromAccounts = accountsData && extractEvmAddressFromPluginPayload(accountsData);
  if (fromAccounts) {
    recordTrackingWalletAddress(fromAccounts);
    return fromAccounts;
  }

  const hint =
    getExtensionHintFromPayload(connectData) ??
    getExtensionHintFromPayload(accountsData) ??
    "请先在浏览器中打开 Gate Wallet 扩展并连接后再重试。";
  throw new Error(`plugin_wallet 未获取到 EVM 地址。${hint}`);
}

function transactionGas(tx: TransactionSerializable): bigint | undefined {
  if ("gas" in tx && tx.gas != null) return tx.gas;
  if ("gasLimit" in tx && (tx as { gasLimit?: bigint }).gasLimit != null) {
    return (tx as { gasLimit: bigint }).gasLimit;
  }
  return undefined;
}

function transactionGasPriceHex(tx: TransactionSerializable): Hex {
  if ("maxFeePerGas" in tx && tx.maxFeePerGas != null && tx.maxFeePerGas > 0n) {
    return toHex(tx.maxFeePerGas);
  }
  if ("gasPrice" in tx && tx.gasPrice != null && tx.gasPrice > 0n) {
    return toHex(tx.gasPrice);
  }
  throw new Error(
    "createPluginWalletSigner.signTransaction: 缺少 maxFeePerGas 或 gasPrice，无法调用插件 sign_transaction。",
  );
}

function transactionNonceHex(tx: TransactionSerializable): Hex {
  const n = tx.nonce;
  if (n === undefined) {
    throw new Error("createPluginWalletSigner.signTransaction: 缺少 nonce。");
  }
  return typeof n === "number" ? toHex(BigInt(n)) : toHex(BigInt(n as bigint));
}

/**
 * 连接浏览器插件钱包并解析 EVM 地址（connect_wallet → 必要时 get_accounts）。
 * 供 MPP session、x402 等入口复用。
 */
export async function connectPluginWalletEvmForSigning(
  client: PluginWalletClient,
): Promise<`0x${string}`> {
  const connectResult = await client.connectWallet();
  if (connectResult && typeof connectResult === "object" && "isError" in connectResult) {
    const mcpResult = connectResult as { isError?: boolean };
    if (mcpResult.isError) {
      const data = parseMcpToolResult<Record<string, unknown>>(connectResult);
      const errorMsg = data?.error;
      if (typeof errorMsg === "string") {
        if (errorMsg.includes("拒绝") || errorMsg.includes("reject")) {
          throw new Error(`无法连接浏览器钱包：${errorMsg}`);
        }
        throw new Error(`连接浏览器钱包失败：${errorMsg}`);
      }
      throw new Error("连接浏览器钱包失败：未知错误");
    }
  }
  return resolvePluginWalletEvmAddress(client, connectResult);
}

/**
 * 创建插件钱包 Signer (用于 plugin_wallet 签名模式)
 */
export function createPluginWalletSigner(
  client: PluginWalletClient,
  address: `0x${string}`,
): ClientEvmSigner {
  recordTrackingWalletAddress(address);
  const signDigest = async (digest: `0x${string}`): Promise<`0x${string}`> => {
    const result = await client.signMessage(digest, address);
    const data = parseMcpToolResult<Record<string, unknown>>(result);

    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
        "签名失败：未返回有效签名。请确保浏览器钱包已连接并正常工作。",
      );
    }
    return sig;
  };

  const signTypedData = async (msg: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> => {
    if (msg.domain.chainId) {
      const chainId = typeof msg.domain.chainId === 'number' 
        ? `0x${msg.domain.chainId.toString(16)}`
        : String(msg.domain.chainId);
      
      const switchChainResult = await client.switchChain(chainId);
      const switchChainData = parseMcpToolResult<Record<string, unknown>>(switchChainResult);
      if (!switchChainData) {
        throw new Error(
          "切换链失败：未返回有效结果。请确保浏览器钱包已连接并正常工作。",
        );
      }
    }

    const completeTypes = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...msg.types,
    };

    const typedDataJson = serializeTypedDataForMcp({
      domain: msg.domain,
      types: completeTypes,
      primaryType: msg.primaryType,
      message: msg.message,
    });
    console.error("[createPluginWalletSigner] calling signTypedData with:", typedDataJson);
    const result = await client.signTypedData(typedDataJson, address);
    console.error("[createPluginWalletSigner] signTypedData result:", JSON.stringify(result));
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    console.error("[createPluginWalletSigner] parsed data:", JSON.stringify(data));

    const sig = data && extractSignatureFromMcpResult(data);
    console.error("[createPluginWalletSigner] extracted sig:", sig);
    if (!sig) {
      throw new Error(
        "签名失败：未返回有效签名。请确保浏览器钱包已连接并正常工作。",
      );
    }
    return sig;
  };

  const signMessage = async ({ message }: { message: SignableMessage }): Promise<Hex> => {
    const hashed = hashMessage(message);
    return signDigest(hashed as `0x${string}`);
  };

  const signTransaction = async (
    transaction: TransactionSerializable,
    _opts?: unknown,
  ): Promise<Hex> => {
    void _opts;
    const signableTransaction =
      transaction.type === "eip4844"
        ? { ...transaction, sidecars: false as const }
        : transaction;
    const tx = signableTransaction as TransactionSerializable;

    if (!tx.to) {
      throw new Error(
        "createPluginWalletSigner.signTransaction: 无 to 字段（如合约创建）不受插件 sign_transaction 支持。",
      );
    }

    if (tx.chainId != null) {
      const cid =
        typeof tx.chainId === "bigint"
          ? tx.chainId
          : typeof tx.chainId === "number"
            ? BigInt(tx.chainId)
            : BigInt(String(tx.chainId));
      const chainIdHex = `0x${cid.toString(16)}`;
      const switchChainResult = await client.switchChain(chainIdHex);
      const switchChainData = parseMcpToolResult<Record<string, unknown>>(switchChainResult);
      if (!switchChainData) {
        throw new Error(
          "切换链失败：未返回有效结果。请确保浏览器钱包已连接并正常工作。",
        );
      }
    }

    const gas = transactionGas(tx);
    if (gas == null || gas === 0n) {
      throw new Error(
        "createPluginWalletSigner.signTransaction: 缺少 gas，请确认 viem 已用 RPC 准备好交易（含 gas / nonce）。",
      );
    }

    const data =
      typeof tx.data === "string" && tx.data.length > 0 ? tx.data : "0x";
    const value = tx.value ?? 0n;

    const result = await client.evmSignTransaction({
      from: address,
      to: tx.to,
      value: toHex(value),
      data,
      gas: toHex(gas),
      gasPrice: transactionGasPriceHex(tx),
      nonce: transactionNonceHex(tx),
    });

    const parsed = parseMcpToolResult<Record<string, unknown>>(result);
    if (!parsed) {
      throw new Error("插件 sign_transaction 返回空或无法解析的 MCP 结果。");
    }
    const signed = extractSignedEvmRawTransactionHex(parsed);
    if (!signed) {
      throw new Error(
        `插件 sign_transaction：未能解析已签名 raw tx（keys: ${Object.keys(parsed).join(", ")})`,
      );
    }
    return signed;
  };

  return {
    address,
    signTypedData,
    signDigest,
    signMessage,
    signTransaction,
  };
}

export const createSignerFromPluginWallet = createPluginWalletSigner;

/**
 * 创建插件钱包 Solana Signer (用于 plugin_wallet 签名模式的 Solana 网络)
 */
export async function createPluginWalletSolanaSigner(
  client: PluginWalletClient,
  publicKeyBase58: string,
): Promise<ClientSvmSigner> {
  const { address: createAddress } = await import("@solana/addresses");
  const { signatureBytes: createSignatureBytes } = await import("@solana/keys");
  
  const address = createAddress(publicKeyBase58);
  console.error("publicKeyBase58", publicKeyBase58);
  console.error("address", address);

  return {
    address,
    signTransactions: async (transactions, config) => {
      void config;
      
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        const transactionBase64 = getBase64EncodedWireTransaction(transaction);

        const result = await client.solSignTransaction(transactionBase64);
        const data = parseMcpToolResult<Record<string, unknown>>(result);
        
        if (!data) {
          throw new Error("签名失败：未返回有效结果");
        }
        
        console.error("[PluginWallet-Solana] 钱包返回数据:", JSON.stringify(data, null, 2));
        
        const multiSigResult = extractPluginWalletSignatures(data);
        
        if (multiSigResult && multiSigResult.signatures.length > 0) {
          console.error(`[PluginWallet-Solana] 检测到多签交易，插件钱包签了 ${multiSigResult.signatures.length} 个签名`);
          
          const walletSignature = multiSigResult.signatures[0];
          
          console.error(`[PluginWallet-Solana] 使用插件钱包签名 - 槽位 ${walletSignature.index}: ${walletSignature.signature.slice(0, 20)}...`);
          
          const signatureBytesArray = base58.decode(walletSignature.signature);
          const signature = createSignatureBytes(signatureBytesArray);
          
          const signatureDictionary = {
            [address]: signature,
          };
          
          signatureDictionaries.push(signatureDictionary);
        } else {
          console.error("[PluginWallet-Solana] 未检测到多签格式，使用单签提取方法");
          
          const signatureBase58 = extractSolanaSignature(data);
          if (!signatureBase58) {
            throw new Error("签名失败：未返回有效签名");
          }
          
          const signatureBytesArray = base58.decode(signatureBase58);
          const signature = createSignatureBytes(signatureBytesArray);
          
          const signatureDictionary = {
            [address]: signature,
          };
          
          signatureDictionaries.push(signatureDictionary);
        }
      }
      
      return signatureDictionaries;
    },
  };
}
