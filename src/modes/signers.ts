/**
 * EVM & SVM Signers for different signing modes:
 * - Local Private Key (for local_private_key mode)
 * - Quick Wallet (for quick_wallet mode via MCP托管钱包)  
 * - Plugin Wallet (for plugin_wallet mode via 浏览器插件钱包)
 */
import { signAsync } from "@noble/secp256k1";
import type { Hex } from "viem";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes, getBase64EncodedWireTransaction } from "@solana/kit";
import { base58 } from "@scure/base";
import type { ClientEvmSigner, ClientSvmSigner } from "../x402/types.js";
import type { PluginWalletClient } from "../wallets/plugin-wallet-client.js";
import { buildEip712TypedDataDigest } from "../x402/utils.js";
import type { GateMcpClient } from "../wallets/wallet-mcp-clients.js";

/**
 * 将 Solana 交易编码为 Base58 字符串
 * 
 * 类似于 @solana/transactions 的 getBase64EncodedWireTransaction，
 * 但返回 Base58 编码而不是 Base64。
 * 
 * @param transaction - 要编码的 Solana 交易
 * @returns Base58 编码的交易字符串
 * 
 * @example
 * ```typescript
 * const wireTransactionBase58 = getBase58EncodedWireTransaction(transaction);
 * // 可以发送给支持 Base58 的 API
 * ```
 */
function getBase58EncodedWireTransaction(
  transaction: import("@solana/transactions").Transaction,
  transactionEncoder: ReturnType<typeof import("@solana/transactions").getTransactionEncoder>
): string {
  // 使用 getTransactionEncoder() 获取完整的序列化交易字节
  // 这包括签名槽位、消息和其他元数据
  const wireTransactionBytes = transactionEncoder.encode(transaction);
  // 将 ReadonlyUint8Array 转换为 Uint8Array 供 base58.encode 使用
  return base58.encode(new Uint8Array(wireTransactionBytes));
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 通用辅助函数 (Common Utilities)
// ═══════════════════════════════════════════════════════════════════════════════════

type NobleSig = { toCompactRawBytes(): Uint8Array; recovery?: number };

function toHexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 解析 MCP tool 调用的返回结果 */
function parseMcpToolResult<T = Record<string, unknown>>(
  result: Awaited<ReturnType<GateMcpClient["callTool"]>> | unknown,
): T | null {
  if (result == null || typeof result !== "object" || !("content" in result)) return null;
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return null;
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") return null;
  try {
    let parsed: unknown = JSON.parse(first.text);
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** 将 EIP-712 结构转为可 JSON 序列化的对象（BigInt → 字符串） */
function typedDataToPlainObject(msg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(msg)) {
    if (typeof v === "bigint") {
      out[k] = v.toString();
    } else if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = typedDataToPlainObject(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** 序列化 EIP-712 typed data 为 MCP 可用的 JSON 字符串 */
function serializeTypedDataForMcp(msg: Record<string, unknown>): string {
  return JSON.stringify(typedDataToPlainObject(msg));
}

/** 从签名的 hex 字符串取末尾 r(32)+s(32)+v(1) 共 65 字节 */
function extractSignatureFromTxHex(hexNo0x: string): `0x${string}` | null {
  if (hexNo0x.length < 130) return null;
  const tail = hexNo0x.slice(-130);
  const r = tail.slice(0, 64);
  const s = tail.slice(64, 128);
  const v = tail.slice(128, 130);
  return `0x${r}${s}${v}` as `0x${string}`;
}

/**
 * 解析 MCP 钱包返回的签名数据，支持多种格式：
 * - {"signature":"...","publicKey":"...","signedTransaction":"..."}
 * - 或 signedTransaction / signed_transaction 等 RLP hex
 */
function extractSignatureFromMcpResult(data: Record<string, unknown>): `0x${string}` | null {
  const sig = data.signature ?? data.signed_signature;

  // 检查 signature 是否为错误对象（例如用户取消签名）
  if (sig && typeof sig === "object" && !Array.isArray(sig)) {
    const errorObj = sig as Record<string, unknown>;
    if (errorObj.code !== undefined || errorObj.message !== undefined) {
      // 这是一个错误对象，不是有效签名
      // 将错误信息传递到上层处理
      const code = errorObj.code;
      const message = errorObj.message;
      throw new Error(
        code === 4001
          ? `用户取消了签名请求:${message}`
          : `签名失败：${message ?? "未知错误"} (code: ${code})`
      );
    }
  }

  console.error("[extractSignatureFromMcpResult] sig value:", sig);

  if (typeof sig === "string" && sig.length > 0) {
    const hex = sig.replace(/^0x/i, "").trim();
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === 130) {
      return `0x${hex}` as `0x${string}`;
    }
    if (sig.startsWith("0x") && /^0x[0-9a-fA-F]{130}$/i.test(sig)) {
      return sig as `0x${string}`;
    }
  }

  const raw =
    data.signedTransaction ??
    data.signed_transaction ??
    data.raw_transaction ??
    data.raw_tx;

  console.error("[extractSignatureFromMcpResult] raw value:", raw);

  if (typeof raw === "string" && raw.length > 0) {
    const hex = raw.replace(/^0x/i, "").trim();
    return extractSignatureFromTxHex(hex);
  }

  console.error("[extractSignatureFromMcpResult] no signature found, returning null");
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// LOCAL PRIVATE KEY SIGNER (用于 local_private_key 签名模式)
// ═══════════════════════════════════════════════════════════════════════════════════

/** 使用本地私钥对 digest 进行签名 */
async function signDigestWithPrivateKey(
  digest: Hex,
  privateKey: Hex,
): Promise<`0x${string}`> {
  const msg = hexToBytes(digest);
  if (msg.length !== 32) throw new Error(`Digest must be 32 bytes, got ${msg.length}`);
  const key = hexToBytes(
    privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
  );
  const sig = (await signAsync(msg, key)) as unknown as NobleSig;
  const compact = sig.toCompactRawBytes();
  if (compact.length !== 64) {
    throw new Error(`Expected 64-byte compact signature, got ${compact.length}`);
  }
  const recovery = sig.recovery ?? 0;
  const v = 27 + (recovery & 1);
  const rHex = toHexFromBytes(compact.slice(0, 32));
  const sHex = toHexFromBytes(compact.slice(32, 64));
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${rHex}${sHex}${vHex}` as `0x${string}`;
}

/**
 * 创建本地私钥 Signer (用于 local_private_key 签名模式)
 * 
 * 特点：
 * - 完全本地签名，不依赖远程服务
 * - 支持 signTypedData (EIP-712) 和 signDigest  
 * - 适用于开发环境和对安全性要求高的场景
 */
export function createLocalPrivateKeySigner(privateKey: Hex): ClientEvmSigner {
  const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
  const account = privateKeyToAccount(key as `0x${string}`);
  return {
    address: account.address,
    signTypedData: (msg) => account.signTypedData(msg),
    signDigest: (digest) => signDigestWithPrivateKey(digest, key),
  };
}

// 保持向后兼容
export const createSignerFromPrivateKey = createLocalPrivateKeySigner;

// ═══════════════════════════════════════════════════════════════════════════════════
// LOCAL SOLANA PRIVATE KEY SIGNER (用于 Solana 网络的 local_private_key 签名模式)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * 创建本地 Solana 私钥 Signer (用于 Solana 网络的 local_private_key 签名模式)
 * 
 * 特点：
 * - 完全本地签名，不依赖远程服务
 * - 直接返回 @solana/kit 的 KeyPairSigner
 * - 适用于 Solana/SVM 网络
 * - 私钥格式为 base58 编码的字符串
 * 
 * @param privateKeyBase58 - Base58 编码的私钥字符串
 * @returns ClientSvmSigner (即 TransactionSigner) 实例
 */
export async function createLocalSolanaPrivateKeySigner(
  privateKeyBase58: string,
): Promise<ClientSvmSigner> {
  const privateKeyBytes = base58.decode(privateKeyBase58);
  return await createKeyPairSignerFromBytes(privateKeyBytes);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// PLUGIN WALLET SIGNER (用于 plugin_wallet 签名模式)  
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * 创建插件钱包 Signer (用于 plugin_wallet 签名模式)
 * 
 * 特点：
 * - 通过浏览器插件钱包 (如 Gate Wallet) 进行签名
 * - signTypedData: 传递完整的 EIP-712 四字段 JSON 给插件钱包处理
 * - signDigest: 直接传递 digest 给插件钱包的 sign_message
 * - 需要用户在浏览器中手动确认签名
 */
export function createPluginWalletSigner(
  client: PluginWalletClient,
  address: `0x${string}`,
): ClientEvmSigner {
  const signDigest = async (digest: `0x${string}`): Promise<`0x${string}`> => {
    const result = await client.signMessage(digest, address);
    const data = parseMcpToolResult<Record<string, unknown>>(result);

    // extractSignatureFromMcpResult 会在检测到错误对象时抛出友好的错误信息
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
    // 插件钱包需要先切换到目标链
    // 从 domain 中提取 chainId 并转换为 hex 格式
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

    // 确保 types 中包含 EIP712Domain 定义
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

    // extractSignatureFromMcpResult 会在检测到错误对象时抛出友好的错误信息
    const sig = data && extractSignatureFromMcpResult(data);
    console.error("[createPluginWalletSigner] extracted sig:", sig);
    if (!sig) {
      throw new Error(
        "签名失败：未返回有效签名。请确保浏览器钱包已连接并正常工作。",
      );
    }
    return sig;
  };

  return {
    address,
    signTypedData,
    signDigest,
  };
}

// 保持向后兼容
export const createSignerFromPluginWallet = createPluginWalletSigner;

// ═══════════════════════════════════════════════════════════════════════════════════
// PLUGIN WALLET SOLANA SIGNER (用于 plugin_wallet 签名模式的 Solana 支持)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * 创建插件钱包 Solana Signer (用于 plugin_wallet 签名模式的 Solana 网络)
 * 
 * 特点：
 * - 通过浏览器插件钱包 (如 Gate Wallet) 的 Solana 功能进行签名
 * - 支持交易签名（实现 TransactionPartialSigner 接口）
 * - 需要用户在浏览器中手动确认签名
 * - 使用 sol_sign_transaction 工具
 */
export async function createPluginWalletSolanaSigner(
  client: PluginWalletClient,
  publicKeyBase58: string,
): Promise<ClientSvmSigner> {
  // 导入所需的函数
  const { address: createAddress } = await import("@solana/addresses");
  const { signatureBytes: createSignatureBytes } = await import("@solana/keys");
  
  // 使用 address 函数创建符合 Address 类型的地址
  const address = createAddress(publicKeyBase58);
  console.error("publicKeyBase58", publicKeyBase58);
  console.error("address", address);

  return {
    address,
    signTransactions: async (transactions, config) => {
      void config; // 暂不使用 config 参数
      
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        // 将交易序列化为 base64 编码
        const transactionBase64 = getBase64EncodedWireTransaction(transaction);

        // 调用插件钱包签名
        const result = await client.solSignTransaction(transactionBase64);
        const data = parseMcpToolResult<Record<string, unknown>>(result);
        
        if (!data) {
          throw new Error("签名失败：未返回有效结果");
        }
        
        console.error("[PluginWallet-Solana] 钱包返回数据:", JSON.stringify(data, null, 2));
        
        // 尝试使用新的多签提取方法（插件钱包专用）
        const multiSigResult = extractPluginWalletSignatures(data);
        
        if (multiSigResult && multiSigResult.signatures.length > 0) {
          // 插件钱包返回了多签信息
          console.error(`[PluginWallet-Solana] 检测到多签交易，插件钱包签了 ${multiSigResult.signatures.length} 个签名`);
          
          // 对于多签交易，我们需要返回钱包签名的那个槽位的签名
          // 通常插件钱包会在 signedBy 中明确指出它签了哪些位置
          const walletSignature = multiSigResult.signatures[0]; // 取第一个钱包签名
          
          console.error(`[PluginWallet-Solana] 使用插件钱包签名 - 槽位 ${walletSignature.index}: ${walletSignature.signature.slice(0, 20)}...`);
          
          // 解析签名为字节数组并转换为 SignatureBytes 类型
          const signatureBytesArray = base58.decode(walletSignature.signature);
          const signature = createSignatureBytes(signatureBytesArray);
          
          // 构建签名字典：{ [publicKey]: signature }
          const signatureDictionary = {
            [address]: signature,
          };
          
          signatureDictionaries.push(signatureDictionary);
        } else {
          // 回退到旧的单签提取方法
          console.error("[PluginWallet-Solana] 未检测到多签格式，使用单签提取方法");
          
          const signatureBase58 = extractSolanaSignature(data);
          if (!signatureBase58) {
            throw new Error("签名失败：未返回有效签名");
          }
          
          // 解析签名为字节数组并转换为 SignatureBytes 类型
          const signatureBytesArray = base58.decode(signatureBase58);
          const signature = createSignatureBytes(signatureBytesArray);
          
          // 构建签名字典：{ [publicKey]: signature }
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

/**
 * 从 MCP 返回结果中提取 Solana 签名
 * 
 * 返回值：
 * - string: Base58 编码的签名
 * - null: 未找到有效签名
 * 
 * 注意：此函数会尝试智能识别正确的签名位置，但在多签名交易中可能需要额外验证
 */
/**
 * 从 Quick Wallet MCP 返回结果中提取 Solana 签名
 * 
 * Quick Wallet 返回格式：
 * ```json
 * {
 *   "signature": "161e1cf41d39ac5358b1713ebef6b219bd4ac6ef2b3deed6815ada1501a0b9f38c2f70864293a75af5c7ed269d42d62d4cb27ba1c9d4d339ede30e8fba827a0b",
 *   "publicKey": "0c31b6a5799719be8f62673948deafc2340520eca3dbc3d271d94705d38ecc9a",
 *   "signedTransaction": "base58_encoded_signed_transaction..."
 * }
 * ```
 * 
 * @param data - Quick Wallet MCP 返回的数据对象
 * @returns 签名信息，包含 hex 和 base58 格式
 */
function extractQuickWalletSolanaSignature(
  data: Record<string, unknown>
): { signatureHex: string; signatureBase58: string; publicKeyHex: string } | null {
  // 检查必需字段
  const signatureHex = data.signature;
  const publicKeyHex = data.publicKey;
  
  if (typeof signatureHex !== "string" || signatureHex.length !== 128) {
    console.error("[extractQuickWalletSolanaSignature] 签名格式无效，应为 128 字符的 hex 字符串");
    return null;
  }
  
  if (typeof publicKeyHex !== "string" || publicKeyHex.length !== 64) {
    console.error("[extractQuickWalletSolanaSignature] 公钥格式无效，应为 64 字符的 hex 字符串");
    return null;
  }
  
  try {
    // 将 hex 签名转换为 base58
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );
    const signatureBase58 = base58.encode(signatureBytes);
    
    console.error("[extractQuickWalletSolanaSignature] ✓ 解析成功");
    console.error("  - 签名 (hex):", signatureHex);
    console.error("  - 签名 (base58):", signatureBase58);
    console.error("  - 公钥 (hex):", publicKeyHex);
    
    return {
      signatureHex,
      signatureBase58,
      publicKeyHex,
    };
  } catch (error) {
    console.error("[extractQuickWalletSolanaSignature] 转换失败:", error);
    return null;
  }
}

/**
 * 从 Plugin Wallet MCP 返回结果中提取 Solana 签名
 * 
 * Plugin Wallet 返回的 signedTransaction 是一个字节数组对象
 * 
 * @param data - Plugin Wallet MCP 返回的数据对象
 * @param options - 可选配置
 * @returns Base58 编码的签名字符串
 */
function extractSolanaSignature(
  data: Record<string, unknown>,
  options?: { 
    walletAddress?: string;  // 用于验证签名对应的钱包地址
    preferredSlotIndex?: number;  // 首选的签名槽位索引（0-based）
  }
): string | null {
  // 1. 检查标准的签名字段（Base58 字符串）
  const signature = data.signature ?? data.sig;
  
  if (typeof signature === "string" && signature.length > 0) {
    console.error("[extractSolanaSignature] 使用标准签名字段");
    return signature;
  }
  
  // 2. 检查 signedTransaction（对象形式的字节数组，插件钱包返回格式）
  const signedTx = data.signedTransaction;
  if (signedTx && typeof signedTx === "object" && !Array.isArray(signedTx)) {
    try {
      // 将对象转换为 Uint8Array
      const keys = Object.keys(signedTx);
      const bytes = new Uint8Array(keys.length);
      
      for (const key of keys) {
        const index = parseInt(key, 10);
        const value = (signedTx as Record<string, unknown>)[key];
        if (typeof value === "number") {
          bytes[index] = value;
        }
      }
      
      console.error("[extractSolanaSignature] 已签名交易总字节数:", bytes.length);
      
      // Solana 交易格式：
      // - 第1字节：签名数量
      // - 接下来每个签名占 64 字节
      
      const signatureCount = bytes[0];
      console.error("[extractSolanaSignature] 签名数量:", signatureCount);
      
      if (signatureCount === 0) {
        console.warn("[extractSolanaSignature] 签名数量为0，交易未签名");
        return null;
      }
      
      // 检查每个签名槽，找到非空的签名
      const signatures: Array<{ index: number; bytes: Uint8Array; base58: string; isEmpty: boolean }> = [];
      
      for (let i = 0; i < signatureCount; i++) {
        const startByte = 1 + (i * 64);
        const endByte = startByte + 64;
        
        if (bytes.length < endByte) {
          console.warn(`[extractSolanaSignature] 签名槽 ${i} 超出交易字节范围`);
          break;
        }
        
        const sigBytes = bytes.slice(startByte, endByte);
        const isEmpty = sigBytes.every(b => b === 0);
        const sigBase58 = isEmpty ? "(空)" : base58.encode(sigBytes);
        
        signatures.push({
          index: i,
          bytes: sigBytes,
          base58: sigBase58,
          isEmpty,
        });
        
        console.error(`[extractSolanaSignature] 签名槽 ${i}: ${isEmpty ? "空" : sigBase58.slice(0, 20) + "..."}`);
      }
      
      // 策略1: 如果指定了首选槽位，使用该槽位
      if (options?.preferredSlotIndex !== undefined) {
        const preferred = signatures.find(s => s.index === options.preferredSlotIndex);
        if (preferred && !preferred.isEmpty) {
          console.error(`[extractSolanaSignature] ✓ 使用首选槽位 ${options.preferredSlotIndex}`);
          return preferred.base58;
        } else {
          console.warn(`[extractSolanaSignature] 首选槽位 ${options.preferredSlotIndex} 为空或不存在`);
        }
      }
      
      // 策略2: 使用第一个非空签名（通常客户端签名在前）
      const firstNonEmpty = signatures.find(s => !s.isEmpty);
      if (firstNonEmpty) {
        console.error(`[extractSolanaSignature] ✓ 使用第一个非空签名（槽位 ${firstNonEmpty.index}）`);
        return firstNonEmpty.base58;
      }
      
      console.warn("[extractSolanaSignature] 所有签名槽都为空");
      return null;
      
    } catch (error) {
      console.error("[extractSolanaSignature] 解析 signedTransaction 失败:", error);
      return null;
    }
  }
  
  console.warn("[extractSolanaSignature] 未找到签名数据");
  return null;
}

/**
 * 从插件钱包返回的多签交易数据中提取签名信息
 * 
 * 插件钱包返回格式：
 * {
 *   "signedTransaction": "base58编码的完整交易",
 *   "signatures": [
 *     {"index": 0, "signature": "...", "isEmpty": true/false},
 *     {"index": 1, "signature": "...", "isEmpty": false}
 *   ],
 *   "signedBy": [{"index": N, "signature": "..."}],
 *   "fullySignedTransaction": false
 * }
 * 
 * @param data - 插件钱包返回的数据
 * @returns 签名信息对象，包含钱包签名的槽位索引和签名值
 */
function extractPluginWalletSignatures(
  data: Record<string, unknown>
): { signatures: Array<{ index: number; signature: string }> } | null {
  // 1. 检查是否有 signedBy 字段（插件钱包特有）
  const signedBy = data.signedBy;
  
  if (!Array.isArray(signedBy) || signedBy.length === 0) {
    console.warn("[extractPluginWalletSignatures] 未找到 signedBy 字段或为空");
    return null;
  }
  
  // 2. 提取所有钱包签名的信息
  const signatures: Array<{ index: number; signature: string }> = [];
  
  for (const item of signedBy) {
    if (
      typeof item === "object" && 
      item !== null && 
      "index" in item && 
      "signature" in item
    ) {
      const sig = item as { index: unknown; signature: unknown };
      
      if (
        typeof sig.index === "number" && 
        typeof sig.signature === "string" && 
        sig.signature.length > 0
      ) {
        signatures.push({
          index: sig.index,
          signature: sig.signature,
        });
        console.error(`[extractPluginWalletSignatures] 找到签名 - 槽位 ${sig.index}: ${sig.signature.slice(0, 20)}...`);
      }
    }
  }
  
  if (signatures.length === 0) {
    console.warn("[extractPluginWalletSignatures] signedBy 中没有有效的签名");
    return null;
  }
  
  console.error(`[extractPluginWalletSignatures] ✓ 成功提取 ${signatures.length} 个签名`);
  return { signatures };
}

// ═══════════════════════════════════════════════════════════════════════════════════  
// QUICK WALLET SIGNER (用于 quick_wallet 签名模式)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * 创建快速托管钱包 Signer (用于 quick_wallet 签名模式)
 * 
 * 特点：
 * - 通过远程 MCP 托管钱包服务进行签名
 * - signDigest: 使用 wallet.sign_message  
 * - signTypedData: 使用 wallet.sign_transaction 传递序列化的 typed data
 * - 需要用户通过 OAuth (Google/Gate) 登录并获得 mcp_token
 * - 完全托管，用户无需管理私钥
 */
export async function createQuickWalletSigner(
  mcp: GateMcpClient,
  options?: { evmAddress?: `0x${string}` },
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

  const signDigest = async (digest: `0x${string}`): Promise<`0x${string}`> => {
    const result = await mcp.walletSignMessage("EVM", digest);
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
  }): Promise<`0x${string}`> => {

    const digest = buildEip712TypedDataDigest(msg as Parameters<typeof buildEip712TypedDataDigest>[0]);
    const digestForMcp = digest.replace(/^0x/i, "");
    console.error("[createSignerFromMcpWallet] typedData digest:", digestForMcp);
    const result = await mcp.walletSignMessage("EVM", digestForMcp);

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

  return {
    address,
    signTypedData,
    signDigest,
  };
}

// 保持向后兼容
export const createSignerFromMcpWallet = createQuickWalletSigner;

// ═══════════════════════════════════════════════════════════════════════════════════
// QUICK WALLET SOLANA SIGNER (用于 quick_wallet 签名模式的 Solana 支持)
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * 创建快速托管钱包 Solana Signer (用于 quick_wallet 签名模式的 Solana 网络)
 * 
 * 特点：
 * - 通过远程 MCP 托管钱包服务进行签名
 * - 需要用户通过 OAuth (Google/Gate) 登录并获得 mcp_token
 * - 完全托管，用户无需管理私钥
 * 
 */
export async function createQuickWalletSolanaSigner(
  mcp: GateMcpClient,
  options?: { solAddress?: string },
): Promise<ClientSvmSigner> {
  let address: string; // 临时使用 string，实际应该是 Address 类型
  if (options?.solAddress) {
    address = options.solAddress;
  } else {
    const addrResult = await mcp.walletGetAddresses();
    const data = parseMcpToolResult<{ addresses?: Record<string, string> }>(addrResult);
    const sol = data?.addresses?.SOL; // EVM → SOL
    if (!sol) { // 移除 startsWith("0x") 检查，Solana 地址是 base58 格式
      throw new Error(
        "createQuickWalletSolanaSigner: no SOL address in wallet.get_addresses response",
      );
    }
    address = sol;
    console.error("createQuickWalletSolanaSigner address", address);
  }

  // 导入所需的函数
  const { address: createAddress } = await import("@solana/addresses");
  const { signatureBytes: createSignatureBytes } = await import("@solana/keys");
  const { getTransactionEncoder } = await import("@solana/transactions");
  
  // 使用 address 函数创建符合 Address 类型的地址
  const solAddress = createAddress(address);
  
  // 创建交易编码器（复用）
  const transactionEncoder = getTransactionEncoder();

  return {
    address: solAddress,
    signTransactions: async (transactions, config) => {
      void config; // 暂不使用 config 参数
      console.error("[quick-wallet-solana]signTransactions transactions", transactions);
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        // 将交易序列化为 Base58 编码（MCP 接口使用 Base58）
        // 参照 getBase64EncodedWireTransaction 的实现
        const transactionBase58 = getBase58EncodedWireTransaction(transaction, transactionEncoder);
        console.error("[quick-wallet-solana] 交易 Base58 长度:", transactionBase58.length);

        // 调用 Quick Wallet MCP 签名 - 使用 walletSignTransaction
        // chain: "SOL", rawUnsignedTransaction: base58 encoded transaction
        const result = await mcp.walletSignTransaction("SOL", {
          raw_tx: transactionBase58
        });
        
        // 解析返回结果
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
        
        // 解析返回的 JSON
        let data: unknown;
        try {
          data = JSON.parse(firstItem.text);
        } catch {
          throw new Error("签名失败：返回数据不是有效的 JSON");
        }
        
        // 验证返回数据是对象
        if (!data || typeof data !== "object") {
          throw new Error("签名失败：返回数据不是有效的对象");
        }
        
        // 从返回结果中提取签名
        // Quick Wallet 返回格式: 
        // { signature: "hex_string", publicKey: "hex_string", signedTransaction: "base58_string" }
        const signatureInfo = extractQuickWalletSolanaSignature(data as Record<string, unknown>);
        
        if (!signatureInfo) {
          throw new Error("签名失败：无法从返回数据中提取签名");
        }
        
        console.error("[quick-wallet-solana] 签名提取成功:", signatureInfo.signatureBase58);
        
        // 将 Base58 签名转换为 SignatureBytes
        const signatureBytesArray = base58.decode(signatureInfo.signatureBase58);
        const signature = createSignatureBytes(signatureBytesArray);
        
        // 构建签名字典：{ [publicKey]: signature }
        const signatureDictionary = {
          [solAddress]: signature,
        };
        
        signatureDictionaries.push(signatureDictionary);
      }
      
      return signatureDictionaries;
    },
  } as ClientSvmSigner;
}
