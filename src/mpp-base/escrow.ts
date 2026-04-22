/**
 * 托管合约侧：channelId 推导 + EIP-712（Voucher、OpenAuthorization）。
 * 链上开通 / 结算由服务端完成。
 */
import type { Address, Hex } from 'viem'
import { encodeAbiParameters, keccak256 } from 'viem'

// --- 托管合约 EIP-712（与 AgentPaymentChannel 代理一致；verifyingContract = 代理地址）---

export const ESCROW_EIP712_DOMAIN_NAME = 'AgentPaymentChannel' as const
const ESCROW_EIP712_DOMAIN_VERSION = '1' as const

function escrowEip712Domain(escrowContract: Address, chainId: number) {
  return {
    name: ESCROW_EIP712_DOMAIN_NAME,
    version: ESCROW_EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: escrowContract,
  } as const
}

// --- Channel ID（与链上 computeChannelId 一致）---

/**
 * `keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrowContract, chainId))`
 */
export interface ComputeChannelIdParameters {
  payer: Address
  payee: Address
  token: Address
  salt: Hex
  authorizedSigner: Address
  escrowContract: Address
  chainId: number
}

export function computeChannelId(parameters: ComputeChannelIdParameters): Hex {
  const encoded = encodeAbiParameters(
    [
      { type: 'address', name: 'payer' },
      { type: 'address', name: 'payee' },
      { type: 'address', name: 'token' },
      { type: 'bytes32', name: 'salt' },
      { type: 'address', name: 'authorizedSigner' },
      { type: 'address', name: 'escrowContract' },
      { type: 'uint256', name: 'chainId' },
    ],
    [
      parameters.payer,
      parameters.payee,
      parameters.token,
      parameters.salt,
      parameters.authorizedSigner,
      parameters.escrowContract,
      BigInt(parameters.chainId),
    ],
  )
  return keccak256(encoded)
}

// --- Voucher（累计结算凭证）---

const VOUCHER_EIP712_TYPES = {
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'cumulativeAmount', type: 'uint128' },
  ],
} as const

/**
 * 签名 Voucher（链下累计支付承诺）。domain / types 须与链上验证逻辑一致。
 */
export async function signVoucher(
  account: { address: Address; signTypedData: (params: unknown) => Promise<Hex> },
  params: {
    channelId: Hex
    cumulativeAmount: bigint
    escrowContract: Address
    chainId: number
  },
): Promise<Hex> {
  const { channelId, cumulativeAmount, escrowContract, chainId } = params

  const typedData = {
    domain: escrowEip712Domain(escrowContract, chainId),
    primaryType: 'Voucher' as const,
    message: {
      channelId,
      cumulativeAmount: cumulativeAmount.toString(),
    },
    types: VOUCHER_EIP712_TYPES,
  }

  return account.signTypedData(typedData as unknown as Parameters<typeof account.signTypedData>[0])
}

// --- OpenAuthorization（openWithAuthorization）---

/** 与链上 `openWithAuthorization` 的 OpenAuthorization struct 一致；auth* 须与 USDC EIP-3009 授权字段一致 */
export interface OpenAuthorizationMessage {
  payer: Address
  payee: Address
  token: Address
  deposit: bigint
  salt: Hex
  authorizedSigner: Address
  authValidAfter: bigint
  authValidBefore: bigint
  authNonce: Hex
}

const OPEN_AUTH_EIP712_TYPES = {
  OpenAuthorization: [
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'deposit', type: 'uint128' },
    { name: 'salt', type: 'bytes32' },
    { name: 'authorizedSigner', type: 'address' },
    { name: 'authValidAfter', type: 'uint256' },
    { name: 'authValidBefore', type: 'uint256' },
    { name: 'authNonce', type: 'bytes32' },
  ],
} as const

/**
 * 签名 OpenAuthorization（托管合约 EIP-712；Operator 代付 gas 的开通路径）。
 */
export async function signOpenAuthorization(
  account: { address: Address; signTypedData: (params: unknown) => Promise<Hex> },
  message: OpenAuthorizationMessage,
  params: {
    escrowContract: Address
    chainId: number
  },
): Promise<Hex> {
  const { escrowContract, chainId } = params

  return account.signTypedData({
    domain: escrowEip712Domain(escrowContract, chainId),
    primaryType: 'OpenAuthorization',
    message: {
      payer: message.payer,
      payee: message.payee,
      token: message.token,
      deposit: message.deposit.toString(),
      salt: message.salt,
      authorizedSigner: message.authorizedSigner,
      authValidAfter: message.authValidAfter.toString(),
      authValidBefore: message.authValidBefore.toString(),
      authNonce: message.authNonce,
    },
    types: OPEN_AUTH_EIP712_TYPES,
  } as unknown as Parameters<typeof account.signTypedData>[0])
}
