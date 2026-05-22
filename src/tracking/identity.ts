/**
 * 用户身份解析：Gate uid > EVM（ALS + sticky）> 工具入参/返回值中的地址；无则空串（不再使用 device_id）。
 */
import {
  getTrackingInvocationStore,
} from "./tracking-invocation-context.js";

/** 判断是否为合法的 EVM 地址（0x 开头，40 位 hex）或 Solana 地址（base58，32-44 字符） */
function looksLikeWalletAddress(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return true;
  return false;
}

function extractAddressFromJsonLike(text: string): string | undefined {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    return extractAddressFromObject(obj);
  } catch {
    return undefined;
  }
}

function extractAddressFromObject(obj: Record<string, unknown>): string | undefined {
  const candidateKeys = [
    "accountAddress",
    "account_address",
    "address",
    "wallet_address",
    "walletAddress",
    "from",
    "payer",
    "user_unique_id",
  ];

  for (const key of candidateKeys) {
    const val = obj[key];
    if (looksLikeWalletAddress(val)) return (val as string).trim().toLowerCase();
  }

  for (const val of Object.values(obj)) {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const nested = extractAddressFromObject(val as Record<string, unknown>);
      if (nested) return nested;
    }
  }

  return undefined;
}

function extractTextFromResult(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (!Array.isArray(r.content)) return undefined;
  for (const item of r.content) {
    if (item.type === "text" && item.text) return item.text;
  }
  return undefined;
}

export interface ResolvedIdentity {
  userUniqueId: string;
  idSource: "gate" | "wallet" | "none";
}

function currentStore(): { gateUid?: string; evmAddress?: string } {
  const fromAls = getTrackingInvocationStore();
  return fromAls ?? {};
}

/**
 * 解析埋点 user_unique_id。
 * 优先级：Gate uid（含 sticky）> EVM（含 sticky，无 signer 工具继承上次钱包）> args > result JSON；均无则空串。
 */
export function resolveUserId(
  args: Record<string, unknown> | undefined,
  result: unknown,
): ResolvedIdentity {
  const store = currentStore();
  const gate = store.gateUid?.trim();
  if (gate) return { userUniqueId: gate, idSource: "gate" };

  const evm = store.evmAddress?.trim();
  if (evm) return { userUniqueId: evm, idSource: "wallet" };

  if (args) {
    const argAddr = extractAddressFromObject(args);
    if (argAddr) return { userUniqueId: argAddr, idSource: "wallet" };
  }

  const text = extractTextFromResult(result);
  if (text) {
    const addr = extractAddressFromJsonLike(text);
    if (addr) return { userUniqueId: addr, idSource: "wallet" };
  }

  return { userUniqueId: "", idSource: "none" };
}
