import { base58 } from "@scure/base";
import { getBase64EncodedWireTransaction } from "@solana/kit";
import type { GateMcpClient } from "../../wallets/wallet-mcp-clients.js";

type NobleSig = { toCompactRawBytes(): Uint8Array; recovery?: number };

export function toHexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 将 Solana 交易编码为 Base58 字符串
 */
export function getBase58EncodedWireTransaction(
  transaction: import("@solana/transactions").Transaction,
  transactionEncoder: ReturnType<typeof import("@solana/transactions").getTransactionEncoder>
): string {
  const wireTransactionBytes = transactionEncoder.encode(transaction);
  return base58.encode(new Uint8Array(wireTransactionBytes));
}

export function parseMcpToolResult<T = Record<string, unknown>>(
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

export function typedDataToPlainObject(msg: Record<string, unknown>): Record<string, unknown> {
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

export function serializeTypedDataForMcp(msg: Record<string, unknown>): string {
  return JSON.stringify(typedDataToPlainObject(msg));
}

export function extractSignatureFromTxHex(hexNo0x: string): `0x${string}` | null {
  if (hexNo0x.length < 130) return null;
  const tail = hexNo0x.slice(-130);
  const r = tail.slice(0, 64);
  const s = tail.slice(64, 128);
  const v = tail.slice(128, 130);
  return `0x${r}${s}${v}` as `0x${string}`;
}

export function extractSignatureFromMcpResult(data: Record<string, unknown>): `0x${string}` | null {
  const sig = data.signature ?? data.signed_signature;

  if (sig && typeof sig === "object" && !Array.isArray(sig)) {
    const errorObj = sig as Record<string, unknown>;
    if (errorObj.code !== undefined || errorObj.message !== undefined) {
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

export function extractQuickWalletSolanaSignature(
  data: Record<string, unknown>
): { signatureHex: string; signatureBase58: string; publicKeyHex: string } | null {
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

export function extractSolanaSignature(
  data: Record<string, unknown>,
  options?: { 
    walletAddress?: string;
    preferredSlotIndex?: number;
  }
): string | null {
  const signature = data.signature ?? data.sig;
  
  if (typeof signature === "string" && signature.length > 0) {
    console.error("[extractSolanaSignature] 使用标准签名字段");
    return signature;
  }
  
  const signedTx = data.signedTransaction;
  if (signedTx && typeof signedTx === "object" && !Array.isArray(signedTx)) {
    try {
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
      
      const signatureCount = bytes[0];
      console.error("[extractSolanaSignature] 签名数量:", signatureCount);
      
      if (signatureCount === 0) {
        console.warn("[extractSolanaSignature] 签名数量为0，交易未签名");
        return null;
      }
      
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
      
      if (options?.preferredSlotIndex !== undefined) {
        const preferred = signatures.find(s => s.index === options.preferredSlotIndex);
        if (preferred && !preferred.isEmpty) {
          console.error(`[extractSolanaSignature] ✓ 使用首选槽位 ${options.preferredSlotIndex}`);
          return preferred.base58;
        } else {
          console.warn(`[extractSolanaSignature] 首选槽位 ${options.preferredSlotIndex} 为空或不存在`);
        }
      }
      
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

export function extractPluginWalletSignatures(
  data: Record<string, unknown>
): { signatures: Array<{ index: number; signature: string }> } | null {
  const signedBy = data.signedBy;
  
  if (!Array.isArray(signedBy) || signedBy.length === 0) {
    console.warn("[extractPluginWalletSignatures] 未找到 signedBy 字段或为空");
    return null;
  }
  
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
