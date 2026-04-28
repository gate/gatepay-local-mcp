/**
 * USDC EIP-3009：对代币合约签 `ReceiveWithAuthorization`（domain.verifyingContract = USDC）。
 * 须与链上调用的函数一致：若上链调 `receiveWithAuthorization`，EIP-712 primaryType 须为 `ReceiveWithAuthorization`（与 `TransferWithAuthorization` 的 digest 不同）。
 * `domain.name` 与链上 FiatToken `name()` 一致；优先通过 RPC `name()` 读取，失败时再按 chainId 回退。
 *
 * @see https://eips.ethereum.org/EIPS/eip-3009
 */
import type { Address, Hex } from 'viem'
import { createPublicClient, defineChain, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'

// --- USDC EIP-712（FiatToken；domain.name 须与代币 name() 一致）---

const USDC_EIP712_VERSION = '2' as const

const erc20NameAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

/** RPC 失败或未配置自定义链 RPC 时的保守回退（与历史硬编码一致） */
function usdcEip712DomainNameFallback(chainId: number): string {
  if (chainId === 84532) return 'USDC'
  return 'USD Coin'
}

/**
 * 从代币合约读取 `name()`，用作 EIP-712 domain.name。
 * - Base / Base Sepolia：使用 viem 链定义中的默认公共 RPC。
 * - 其它 chainId：可传 `rpcUrl`（例如与 MPP_BASE_RPC_URL 同源）；未传则仅回退启发式。
 */
export async function resolveUsdcEip712DomainName(
  chainId: number,
  usdcAddress: Address,
  rpcUrl?: string,
): Promise<string> {
  const readName = async (url: string, chain: typeof base | ReturnType<typeof defineChain>) => {
    const client = createPublicClient({
      chain,
      transport: http(url),
    })
    return client.readContract({
      address: usdcAddress,
      abi: erc20NameAbi,
      functionName: 'name',
    }) as Promise<string>
  }

  try {
    if (chainId === base.id) {
      const url = rpcUrl?.trim() || base.rpcUrls.default.http[0]
      if (url) return await readName(url, base)
    }
    if (chainId === baseSepolia.id) {
      const url = rpcUrl?.trim() || baseSepolia.rpcUrls.default.http[0]
      if (url) return await readName(url, baseSepolia)
    }
    const custom = rpcUrl?.trim()
    if (custom) {
      const chain = defineChain({
        id: chainId,
        name: 'usdc-domain-read',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        rpcUrls: { default: { http: [custom] } },
      })
      return await readName(custom, chain)
    }
  } catch {
    // 使用回退
  }
  return usdcEip712DomainNameFallback(chainId)
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
  options?: { rpcUrl?: string },
): Promise<Hex> {
  const domainName = await resolveUsdcEip712DomainName(chainId, usdcAddress, options?.rpcUrl)
  return account.signTypedData({
    domain: {
      name: domainName,
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
