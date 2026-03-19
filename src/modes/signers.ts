/**
 * EVM Signers for different signing modes:
 * - Local Private Key (for local_private_key mode)
 * - Quick Wallet (for quick_wallet mode via MCP托管钱包)  
 * - Plugin Wallet (for plugin_wallet mode via 浏览器插件钱包)
 */
import { signAsync } from "@noble/secp256k1";
import type { Hex } from "viem";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ClientEvmSigner } from "../x402/types.js";
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
  if (typeof raw === "string" && raw.length > 0) {
    const hex = raw.replace(/^0x/i, "").trim();
    return extractSignatureFromTxHex(hex);
  }
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
    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
          "createPluginWalletSigner: sign_message(digest) did not return a signature",
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
    const result = await client.signTypedData(typedDataJson, address);
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
          "createPluginWalletSigner: signTypedData did not return a signature",
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
