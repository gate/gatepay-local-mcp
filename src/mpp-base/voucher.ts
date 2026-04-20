/**
 * Base + USDC：客户端仅签名；authorize / open 由服务端上链。
 * 提供 voucher 的 EIP-712 签名与 channelId 推导（与链上 computeChannelId 一致）。
 */
import type { Address, Hex } from 'viem'
import { encodeAbiParameters, keccak256 } from 'viem'

/**
 * 与链上 `computeChannelId` 一致：
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

/**
 * 签名 Voucher（链下累计支付承诺）
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

  // 与链上 / 服务端 TempoSessionVoucherVerifier 一致：domain name + Voucher 字段类型必须相同，否则 digest 不同。
  const domain = {
    name: 'Tempo Stream Channel',
    version: '1',
    chainId,
    verifyingContract: escrowContract,
  }

  const types = {
    Voucher: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint128' },
    ],
  }

  const typedData = {
    domain,
    primaryType: 'Voucher',
    message: {
      channelId,
      cumulativeAmount: cumulativeAmount.toString(),
    },
    types,
  }

  return account.signTypedData(typedData as unknown as Parameters<typeof account.signTypedData>[0])
}
