/**
 * USDC EIP-3009：对代币合约签 `ReceiveWithAuthorization`（domain.verifyingContract = USDC）。
 * 须与链上调用的函数一致：若上链调 `receiveWithAuthorization`，EIP-712 primaryType 须为 `ReceiveWithAuthorization`（与 `TransferWithAuthorization` 的 digest 不同）。
 * Base 主网官方 USDC 的 ERC20 `name()` 为 `USD Coin`；Base Sepolia 测试币为 `USDC`，domain.name 须与代币 `name()` 一致。
 *
 * @see https://eips.ethereum.org/EIPS/eip-3009
 */
import type { Address, Hex } from 'viem'
import { base, baseSepolia } from 'viem/chains'

// --- USDC EIP-712（FiatToken；domain.name 随链上 name() 可能不同）---

const USDC_EIP712_VERSION = '2' as const

function usdcEip712DomainName(chainId: number): string {
  if (chainId === 84532) return 'USDC'
  return 'USD Coin'
}

const USDC_RECEIVE_AUTH_EIP712_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

// --- 消息与签名 ---

/** 与 FiatToken EIP-3009 授权消息的字段一致（Receive / Transfer 共用同一组字段） */
export interface TransferWithAuthorizationMessage {
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
}

/**
 * 对 USDC 合约上的 `receiveWithAuthorization` 做 EIP-712 签名（primaryType：`ReceiveWithAuthorization`）。
 */
export async function signTransferWithAuthorization(
  account: { address: Address; signTypedData: (params: unknown) => Promise<Hex> },
  message: TransferWithAuthorizationMessage,
  chainId: number,
  usdcAddress: Address,
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      name: usdcEip712DomainName(chainId),
      version: USDC_EIP712_VERSION,
      chainId,
      verifyingContract: usdcAddress,
    },
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: message.from,
      to: message.to,
      value: message.value.toString(),
      validAfter: message.validAfter.toString(),
      validBefore: message.validBefore.toString(),
      nonce: message.nonce,
    },
    types: USDC_RECEIVE_AUTH_EIP712_TYPES,
  } as unknown as Parameters<typeof account.signTypedData>[0])
}

/** @deprecated 使用 {@link signTransferWithAuthorization} */
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

// --- 链 / 请求解析（与 EIP-712 无关，供调用方选用）---

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
