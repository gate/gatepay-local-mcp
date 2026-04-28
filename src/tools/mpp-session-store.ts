/**
 * MPP session 缓存：以 account.address 为 key 复用 Mppx 实例
 * 同一账户多次 init 不会重建实例，保持 channel 状态
 */

import type { Address, Hex } from "viem";

/**
 * MPP SessionManager 最小接口（mppx tempo 或本地 mpp-base baseSession）。
 * 运行时使用实际实例，这里仅用于类型提示。
 */
export interface MppSessionManager {
  readonly channelId: string | undefined;
  readonly cumulative: bigint;
  readonly opened: boolean;
  /** mpp-base：与打开通道时 EIP-712 / 合约地址一致 */
  readonly chainId?: number;
  readonly escrowContract?: Address;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response & MppPaymentResponse>;
  close(): Promise<MppSessionReceipt | undefined>;
  /**
   * mpp-base：链上 `requestClose(bytes32)`；不清理本地 session，与 HTTP close 独立。
   */
  requestCloseOnChain?(params: { rpcUrl: string }): Promise<{ txHash: Hex }>;
  /**
   * mpp-base：链上 `withdraw(bytes32)`；须在链上 requestClose 且经过合约等待期之后（由合约校验）。
   */
  withdrawOnChain?(params: { rpcUrl: string; channelId?: Hex }): Promise<{ txHash: Hex }>;
}

export interface MppPaymentResponse extends Response {
  receipt: MppSessionReceipt | null;
  challenge: unknown | null;
  channelId: string | null;
  cumulative: bigint;
}

export interface MppSessionReceipt {
  method: "tempo" | "base";
  intent: "session";
  status: "success";
  timestamp: string;
  reference: string;
  challengeId: string;
  channelId: string;
  acceptedCumulative: string;
  spent: string;
  units?: number;
  txHash?: string;
}

export interface MppSessionMeta {
  manager: MppSessionManager;
  sessionId: string;
  accountAddress: string;
  createdAt: string;
  signMode: string;
  maxDeposit: string;
}

/** 按 account address 缓存 Mppx 实例 */
const sessions = new Map<string, MppSessionMeta>();

const DEFAULT_SESSION_ID = "default";

/**
 * 获取指定账户的 session，若不存在返回 null
 */
export function getMppSession(address?: string): MppSessionMeta | null {
  if (!address) {
    // 无参数则返回任意一个活跃 session（向后兼容）
    return sessions.values().next().value ?? null;
  }
  return sessions.get(address.toLowerCase()) ?? null;
}

/**
 * 获取所有缓存的 session（用于 list_tools 等场景）
 */
export function getAllMppSessions(): MppSessionMeta[] {
  return Array.from(sessions.values());
}

/**
 * 设置或更新 session
 * - 若账户已存在：复用现有 Mppx 实例（保持 channel），可更新 maxDeposit
 * - 若不存在：创建新实例
 */
export function setMppSession(
  address: string,
  manager: MppSessionManager,
  options?: { sessionId?: string; signMode?: string; maxDeposit?: string }
): MppSessionMeta {
  const key = address.toLowerCase();
  const existing = sessions.get(key);

  if (existing) {
    // 复用已有实例，仅更新 maxDeposit（若需要）
    existing.maxDeposit = options?.maxDeposit ?? existing.maxDeposit;
    existing.sessionId = options?.sessionId ?? existing.sessionId;
    return existing;
  }

  // 新建
  const meta: MppSessionMeta = {
    manager,
    sessionId: options?.sessionId ?? DEFAULT_SESSION_ID,
    accountAddress: key,
    createdAt: new Date().toISOString(),
    signMode: options?.signMode ?? "local_private_key",
    maxDeposit: options?.maxDeposit ?? "1",
  };
  sessions.set(key, meta);
  return meta;
}

/**
 * 清除指定账户的 session，若不指定则清除所有
 */
export function clearMppSession(address?: string): void {
  if (!address) {
    sessions.clear();
    return;
  }
  sessions.delete(address.toLowerCase());
}

/**
 * 检查是否有活跃会话（任一账户）
 */
export function hasMppSession(): boolean {
  for (const meta of sessions.values()) {
    if (meta.manager.opened) return true;
  }
  return false;
}

/**
 * 检查指定账户是否有活跃会话
 */
export function hasMppSessionForAddress(address: string): boolean {
  const meta = sessions.get(address.toLowerCase());
  return meta?.manager.opened ?? false;
}
