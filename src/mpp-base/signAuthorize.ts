/**
 * EIP-3009 TransferWithAuthorization（与 Circle USDC 一致）
 *
 * 链下签名供服务端调用 USDC 合约的 `transferWithAuthorization`，或经托管合约转调。
 * Domain：`name: "USD Coin"`, `version: "2"`, `verifyingContract` = **USDC 地址**（不是 escrow）。
 *
 * @see https://eips.ethereum.org/EIPS/eip-3009
 */
import type { Address, Hex } from 'viem'
import { base, baseSepolia } from 'viem/chains'

/** 与 FiatToken / USDC EIP-3009 对齐的 typed data */
export interface TransferWithAuthorizationMessage {
  /** 付款人（from） */
  from: Address
  /** 收款人（to） */
  to: Address
  /** 授权转账数量（最小单位） */
  value: bigint
  /** 生效最早时间（unix 秒），常用 0 */
  validAfter: bigint
  /** 过期时间（unix 秒） */
  validBefore: bigint
  /** 防重放，bytes32 */
  nonce: Hex
}

/**
 * 对 USDC（`verifyingContract`）上的 TransferWithAuthorization 做 EIP-712 签名。
 */
export async function signTransferWithAuthorization(
  account: { address: Address; signTypedData: (params: unknown) => Promise<Hex> },
  message: TransferWithAuthorizationMessage,
  chainId: number,
  /** USDC 合约地址，即 EIP-712 domain.verifyingContract */
  usdcAddress: Address,
): Promise<Hex> {
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId,
    verifyingContract: usdcAddress,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  return account.signTypedData({
    domain,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: message.from,
      to: message.to,
      value: message.value.toString(),
      validAfter: message.validAfter.toString(),
      validBefore: message.validBefore.toString(),
      nonce: message.nonce,
    },
    types,
  } as unknown as Parameters<typeof account.signTypedData>[0])
}

/** @deprecated 使用 {@link signTransferWithAuthorization}；旧版自定义 Authorize 已废弃 */
export type AuthorizeMessage = TransferWithAuthorizationMessage

/** @deprecated 使用 {@link signTransferWithAuthorization} */
export async function signAuthorizeMessage(
  account: { address: Address; signTypedData: (params: unknown) => Promise<Hex> },
  message: TransferWithAuthorizationMessage,
  chainId: number,
  usdcAddress: Address,
): Promise<Hex> {
  return signTransferWithAuthorization(account, message, chainId, usdcAddress)
}

export function getChainConfig(chainId: number) {
  return chainId === 8453 ? base : baseSepolia
}

export function resolveChainConfig(
  methodDetails?: Record<string, unknown>,
  request?: Record<string, unknown>,
): { chainId: number; currency: Address } {
  const chainId =
    (methodDetails?.chainId as number) ?? (request?.chainId as number) ?? 8453

  const currency =
    (methodDetails?.currency as Address) ??
    (request?.currency as Address) ??
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

  return { chainId, currency }
}
