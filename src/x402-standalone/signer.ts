/**
 * EVM signer: from private key (local) or from MCP wallet (remote sign_transaction).
 */
import { signAsync } from "@noble/secp256k1";
import type { Hex } from "viem";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ClientEvmSigner } from "./types.js";
import type { GateMcpClient } from "./wallet/wallet-mcp-clients.js";

type NobleSig = { toCompactRawBytes(): Uint8Array; recovery?: number };

function toHexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
}

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

export function createSignerFromPrivateKey(privateKey: Hex): ClientEvmSigner {
  const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
  const account = privateKeyToAccount(key as `0x${string}`);
  return {
    address: account.address,
    signTypedData: (msg) => account.signTypedData(msg),
    signDigest: (digest) => signDigestWithPrivateKey(digest, key),
  };
}

// ─── MCP 托管钱包 Signer（通过 wallet.sign_transaction 生成签名）────────────

function parseMcpToolResult<T = Record<string, unknown>>(
    result: Awaited<ReturnType<GateMcpClient["callTool"]>>,
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

/** 供 MCP raw_tx 使用：JSON 字符串 */
function serializeTypedDataForMcp(msg: Record<string, unknown>): string {
  return JSON.stringify(typedDataToPlainObject(msg));
}

/** 从 hex 串取末尾 r(32)+s(32)+v(1) 共 65 字节 */
function signatureFromTxHex(hexNo0x: string): `0x${string}` | null {
  if (hexNo0x.length < 130) return null;
  const tail = hexNo0x.slice(-130);
  const r = tail.slice(0, 64);
  const s = tail.slice(64, 128);
  const v = tail.slice(128, 130);
  return `0x${r}${s}${v}` as `0x${string}`;
}

/**
 * 解析 wallet.sign_message / wallet.sign_transaction 等返回：
 * - {"signature":"...","publicKey":"...","signedTransaction":"..."}（signature 可无 0x）
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
    return signatureFromTxHex(hex);
  }
  return null;
}

/**
 * 使用 MCP 托管钱包的 wallet.sign_transaction 生成签名的 ClientEvmSigner。
 * 需已登录（mcp_token），否则调用会失败。
 *
 * @param mcp 已连接且已认证的 GateMcpClient
 * @param options.evmAddress 若提供则不再请求 wallet.get_addresses
 */
export async function createSignerFromMcpWallet(
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
          "createSignerFromMcpWallet: no EVM address in wallet.get_addresses response",
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
          "createSignerFromMcpWallet: wallet.sign_message(digest) did not return a signature",
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
    const serialized = serializeTypedDataForMcp(
        msg as unknown as Record<string, unknown>,
    );
    const raw_tx: string = String(serialized);
    const result = await mcp.walletSignTransaction("EVM", { raw_tx });
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
          "createSignerFromMcpWallet: wallet.sign_transaction(raw_tx) did not return a signature",
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
