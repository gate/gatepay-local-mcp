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
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import type { ClientEvmSigner, ClientSvmSigner } from "../x402/types.js";
import type { PluginWalletClient } from "../wallets/plugin-wallet-client.js";
import { buildEip712TypedDataDigest } from "../x402/utils.js";
import type { GateMcpClient } from "../wallets/wallet-mcp-clients.js";

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

  console.log("[extractSignatureFromMcpResult] sig value:", sig);

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

  console.log("[extractSignatureFromMcpResult] raw value:", raw);

  if (typeof raw === "string" && raw.length > 0) {
    const hex = raw.replace(/^0x/i, "").trim();
    return extractSignatureFromTxHex(hex);
  }

  console.log("[extractSignatureFromMcpResult] no signature found, returning null");
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
    console.log("[createPluginWalletSigner] calling signTypedData with:", typedDataJson);
    const result = await client.signTypedData(typedDataJson, address);
    console.log("[createPluginWalletSigner] signTypedData result:", JSON.stringify(result));
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    console.log("[createPluginWalletSigner] parsed data:", JSON.stringify(data));

    // extractSignatureFromMcpResult 会在检测到错误对象时抛出友好的错误信息
    const sig = data && extractSignatureFromMcpResult(data);
    console.log("[createPluginWalletSigner] extracted sig:", sig);
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

  return {
    address,
    signTransactions: async (transactions, config) => {
      void config; // 暂不使用 config 参数
      
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        // 将交易序列化为字节数组
        const transactionMessage = transaction.messageBytes;
        
        // 将交易字节转换为 base64 编码
        const transactionBase64 = Buffer.from(transactionMessage).toString('base64');
        
        // 调用插件钱包签名
        const result = await client.solSignTransaction(transactionBase64);
        const data = parseMcpToolResult<Record<string, unknown>>(result);
        
        if (!data) {
          throw new Error("签名失败：未返回有效结果");
        }
        
        // 从返回结果中提取签名
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
      
      return signatureDictionaries;
    },
  };
}

/**
 * 从 MCP 返回结果中提取 Solana 签名
 */
function extractSolanaSignature(data: Record<string, unknown>): string | null {
  // 检查常见的字段名
  const signature = data.signature ?? data.sig;
  
  if (typeof signature === "string" && signature.length > 0) {
    return signature;
  }
  
  return null;
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
    console.log("[createSignerFromMcpWallet] typedData digest:", digestForMcp);
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
    console.log("[createSignerFromMcpWallet] sig:", normalizedSig);

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
 * 注意：本函数逻辑照搬 createQuickWalletSigner，仅将 "EVM" 替换为 "SOL"
 * TODO: 需要根据 Solana 实际签名流程调整以下部分
 */
export async function createQuickWalletSolanaSigner(
  mcp: GateMcpClient,
  options?: { solAddress?: string },
): Promise<ClientSvmSigner> {
  // TODO: 需要调整 - Solana 地址格式不同，需要使用 @solana/addresses 的 address() 函数
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
  }

  // TODO: 需要调整 - signDigest 对应 Solana 应该是 signMessages
  // Solana 没有 signDigest 概念，这里暂时保留作为参考
  const signDigest = async (digest: string): Promise<string> => {
    const result = await mcp.walletSignMessage("SOL", digest); // EVM → SOL
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    // TODO: 需要调整 - extractSignatureFromMcpResult 是为 EVM 设计的
    // Solana 签名格式不同（64 字节 vs 65 字节），需要新的提取函数
    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
        "createQuickWalletSolanaSigner: wallet.sign_message(digest) did not return a signature",
      );
    }
    return sig as string; // 临时类型转换
  };

  // TODO: 需要完全重写 - Solana 使用 signTransactions 而不是 signTypedData
  // 这里保留原结构只是为了展示对比
  const signTypedData = async (msg: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<string> => {
    // TODO: 需要调整 - Solana 不使用 EIP-712，这个函数不适用
    // 实际应该接收 Transaction 对象并序列化为 base64
    const digest = buildEip712TypedDataDigest(msg as Parameters<typeof buildEip712TypedDataDigest>[0]);
    const digestForMcp = digest.replace(/^0x/i, "");
    console.log("[createQuickWalletSolanaSigner] typedData digest:", digestForMcp);
    const result = await mcp.walletSignMessage("SOL", digestForMcp); // EVM → SOL

    const data = parseMcpToolResult<Record<string, unknown>>(result);
    // TODO: 需要调整 - Solana 签名不需要 v 值归一化（EVM 特有）
    const sig = data && extractSignatureFromMcpResult(data);
    let normalizedSig: string | null = sig ? (sig as string) : null; // 修改类型
    if (sig && /^0x[0-9a-fA-F]{130}$/.test(sig)) {
      const vHex = sig.slice(130, 132);
      const v = Number.parseInt(vHex, 16);
      if (v === 0 || v === 1) {
        const normalizedV = (v + 27).toString(16).padStart(2, "0");
        normalizedSig = `${sig.slice(0, 130)}${normalizedV}`;
      }
    }
    console.log("[createQuickWalletSolanaSigner] sig:", normalizedSig);

    if (!normalizedSig) {
      throw new Error(
        "createQuickWalletSolanaSigner: wallet.sign_message(typedData digest) did not return a signature",
      );
    }
    return normalizedSig;
  };

  // TODO: 需要完全重写返回对象 - 应该返回符合 TransactionPartialSigner 接口的对象
  // 当前结构是 EVM 的 ClientEvmSigner，Solana 需要 ClientSvmSigner (TransactionPartialSigner)
  return {
    address: address as never, // TODO: 需要转换为 Address 类型
    signTransactions: async (transactions, config) => {
      void config;
      // TODO: 实现实际的签名逻辑
      // 1. 遍历 transactions
      // 2. 对每个 transaction 调用 mcp.walletSignMessage("SOL", base64_transaction)
      // 3. 返回 SignatureDictionary[]
      throw new Error("signTransactions not implemented yet - need to replace signTypedData logic");
    },
  } as ClientSvmSigner;
}
