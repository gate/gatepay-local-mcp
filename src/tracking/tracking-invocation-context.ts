/**
 * 埋点身份上下文（AsyncLocalStorage + 进程级 sticky）。
 *
 * 安全边界：仅记录 **公钥可推导的链上地址** 与 **Gate uid**。
 * 绝不写入私钥、助记词、access_token、PAYMENT-SIGNATURE 原文或请求 body。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TrackingInvocationStore {
  evmAddress?: string;
  gateUid?: string;
}

const als = new AsyncLocalStorage<TrackingInvocationStore>();

/** 跨工具调用继承：最近一次解析到的 EVM 地址（小写 0x…） */
let stickyEvmAddress: string | undefined;
/** 跨工具调用继承：最近一次 Gate Pay uid */
let stickyGateUid: string | undefined;

function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(s.trim().toLowerCase());
}

/** 供单次 MCP 工具调用的 ALS 入口（在 withTracking 内调用） */
export function runInTrackingInvocation<T>(fn: () => Promise<T>): Promise<T> {
  const store: TrackingInvocationStore = {
    evmAddress: stickyEvmAddress,
    gateUid: stickyGateUid,
  };
  return als.run(store, fn);
}

export function getTrackingInvocationStore(): TrackingInvocationStore | undefined {
  return als.getStore();
}

/**
 * 记录 EVM 地址供当前调用链与后续无 signer 工具继承。
 * 非合法 EVM 格式则忽略，防止误把任意字符串写入埋点。
 */
export function recordTrackingWalletAddress(evmAddress: string): void {
  const n = evmAddress.trim().toLowerCase();
  if (!isEvmAddress(n)) return;
  stickyEvmAddress = n;
  const s = als.getStore();
  if (s) s.evmAddress = n;
}

/** Gate Pay uid：写入 user_unique_id 与 sticky（供后续工具继承） */
export function recordTrackingGateUid(uid: string): void {
  const u = uid.trim();
  if (!u) return;
  stickyGateUid = u;
  const s = als.getStore();
  if (s) s.gateUid = u;
}

/** Gate 登出或清空 token 时同步清空 sticky uid，避免误绑上一用户 */
export function clearTrackingGateUidSticky(): void {
  stickyGateUid = undefined;
  const s = als.getStore();
  if (s) delete s.gateUid;
}

/** 从快捷钱包 MCP 返回的地址对象中尽量解析 EVM 并记录 */
export function recordTrackingWalletFromQuickAddressesPayload(addresses: unknown): void {
  if (addresses == null) return;
  if (typeof addresses === "string") {
    try {
      recordTrackingWalletFromQuickAddressesPayload(JSON.parse(addresses) as unknown);
    } catch {
      /* ignore */
    }
    return;
  }
  if (typeof addresses !== "object") return;
  const o = addresses as Record<string, unknown>;
  const direct = o.EVM ?? o.evm;
  if (typeof direct === "string") {
    recordTrackingWalletAddress(direct);
    return;
  }
  const nested = o.addresses;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    const evm = inner.EVM ?? inner.evm;
    if (typeof evm === "string") recordTrackingWalletAddress(evm);
  }
}
