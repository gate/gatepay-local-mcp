/**
 * Base + USDC Session (mpp-base)
 *
 * 客户端仅做 EIP-712（transferAuth：EIP-3009 + openAuth：OpenAuthorization + voucher：AgentPaymentChannel）；上链由服务端完成。
 * 首次 402 建立通道时 payload action 为 `open`：含 openAuth（托管合约）、transferAuth（USDC）、voucher；USDC EIP-712 domain.name 与链上 `name()` 一致（默认 RPC 读 Base/Sepolia，可选 `usdcDomainRpcUrl`）。
 */
import {
  type Account,
  type Address,
  type Hex,
  createWalletClient,
  defineChain,
  http,
  parseUnits,
  getAddress,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

// 引入 mppx：与 client/internal/Fetch、Receipt、tempo/sessionManager.close 行为对齐
import { Challenge, Credential, Receipt } from 'mppx'
import { Session as TempoSession } from 'mppx/tempo'

import {
  signTransferWithAuthorization,
  type TransferWithAuthorizationMessage,
} from './usdc.js'
import {
  computeChannelId,
  signOpenAuthorization,
  signVoucher,
} from './escrow.js'

// 默认配置
const DEFAULT_CHAIN_ID = 8453  // Base Mainnet
const DEFAULT_ESCROW_CONTRACT: Record<number, Address> = {
  8453: '0x00000000B4ecdF042B75e3afBf1810F323F82D09',
  84532: '0xabB719022DBDBb359dd0D2ad6abfc2EBd513bd15',
}
const DEFAULT_USDC: Record<number, Address> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
}

/** 托管合约 channel 相关写操作最小 ABI */
const escrowChannelActionsAbi = [
  {
    type: 'function',
    name: 'requestClose',
    stateMutability: 'nonpayable' as const,
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable' as const,
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [],
  },
] as const

function chainDefinitionForRpc(chainId: number, rpcUrl: string) {
  if (chainId === base.id) return base
  if (chainId === baseSepolia.id) return baseSepolia
  return defineChain({
    id: chainId,
    name: 'mpp-base-custom',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

/** 与 mppx `tempo` session 方法一致（Accept-Payment 协商） */
const DEFAULT_ACCEPT_PAYMENT = 'tempo/session'

export type PaymentReceipt = ReturnType<typeof Receipt.deserialize>

/**
 * 从成功响应解析 `Payment-Receipt`（base64url JSON）；无头或解析失败时返回 undefined。
 * 与 mppx {@link Receipt.fromResponse} 不同：后者在无头时会抛错。
 */
export function parsePaymentReceipt(response: Response): PaymentReceipt | undefined {
  const raw = response.headers.get('Payment-Receipt')
  if (!raw?.trim()) return undefined
  try {
    return Receipt.deserialize(raw.trim())
  } catch {
    return undefined
  }
}

function getCallerHeaders(input: RequestInfo | URL, headersInit: HeadersInit | undefined): Headers {
  if (headersInit) return new Headers(headersInit)
  return new Headers(input instanceof Request ? input.headers : undefined)
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers as Record<string, string>
}

/** 去掉任意大小写的 Authorization，再设新凭证（与 mppx Fetch.withAuthorizationHeader 一致） */
function withAuthorizationHeader(headers: unknown, credential: string): Record<string, string> {
  const normalized = normalizeHeaders(headers)
  for (const key of Object.keys(normalized)) {
    if (key.toLowerCase() === 'authorization') delete normalized[key]
  }
  normalized.Authorization = credential
  return normalized
}

function validateCredentialHeaderValue(credential: string): void {
  if (!credential.trim()) throw new Error('Credential header value must be non-empty')
  if (credential.includes('\r') || credential.includes('\n')) {
    throw new Error('Credential header value contains illegal newline characters')
  }
}

/**
 * 首次请求若未带 Accept-Payment，则注入（与 mppx client/internal/Fetch.prepareInitialRequest 一致）。
 */
function prepareInitialRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  callerHeaders: Headers,
  acceptPaymentHeader: string,
  hasExplicitAcceptPayment: boolean,
): { headers: Headers; init: RequestInit | undefined; input: RequestInfo | URL } {
  const shouldInject = Boolean(acceptPaymentHeader) && !hasExplicitAcceptPayment
  if (!shouldInject) return { headers: callerHeaders, init, input }

  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  callerHeaders.forEach((value, key) => {
    headers.set(key, value)
  })
  headers.set('Accept-Payment', acceptPaymentHeader)

  if (init) {
    ;(init as RequestInit & { headers?: HeadersInit }).headers = headers
    return { headers, init, input }
  }

  return { headers, init: { headers }, input }
}

/**
 * 402 中可能合并多个 `Payment` challenge（RFC 9110）；优先 `tempo/session`（与 mppx tempo Session 一致）。
 */
function pickSessionChallenge(challenges: Challenge.Challenge[]): Challenge.Challenge {
  const session = challenges.find((c) => c.method === 'tempo' && c.intent === 'session')
  if (session) return session
  if (challenges.length === 1) return challenges[0]!
  throw new Error(
    `Expected a tempo/session challenge; got: ${challenges.map((c) => `${c.method}/${c.intent}`).join(', ')}`,
  )
}

/**
 * 生成随机 bytes32
 */
function randomBytes32(): Hex {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return '0x' + Buffer.from(arr).toString('hex') as Hex
}

/**
 * Base Session 配置
 */
export interface BaseSessionParams {
  account: {
    address: Address
    signTypedData: (params: unknown) => Promise<Hex>
    signTransaction?: (tx: unknown) => Promise<Hex>
  }
  maxDeposit?: string
  decimals?: number
  chainId?: number
  escrowContract?: Address
  authorizedSigner?: Address
  onChannelUpdate?: (entry: ChannelEntry) => void
  /**
   * 与 mppx `Fetch.from` 一致：首次请求未显式带 `Accept-Payment` 时注入，便于与服务端协商。
   * 默认 `tempo/session`；设为空字符串则完全不注入。
   */
  acceptPayment?: string
  /** 默认 `globalThis.fetch` */
  fetchImpl?: typeof fetch
  /**
   * 收到 402 并解析 challenge 后、使用默认 open/voucher 凭证前调用；返回非空 string 则作为 Authorization 替代自动签名。
   */
  onChallenge?: (
    challenge: Challenge.Challenge,
    helpers: { createCredential: () => Promise<string> },
  ) => Promise<string | undefined>
  /** 2xx 响应且存在合法 `Payment-Receipt` 时触发（与 mppx Receipt 模块一致） */
  onPaymentReceipt?: (receipt: PaymentReceipt) => void
  /**
   * 非 Base / Base Sepolia 时，用于 RPC 读取 USDC `name()` 以构造 EIP-712 domain（与 MPP_BASE_RPC_URL 等可对齐）。
   */
  usdcDomainRpcUrl?: string
}

/**
 * Channel 条目
 */
export interface ChannelEntry {
  channelId: Hex
  salt: Hex
  cumulativeAmount: bigint
  escrowContract: Address
  chainId: number
  opened: boolean
}

/**
 * EIP-3009（ReceiveWithAuthorization digest）：仅传 message + signature（与顶层 voucher 的 `signature` 区分）；上链须调 `receiveWithAuthorization` 与之对应。
 */
export interface TransferAuthEip712 {
  message: {
    from: Address
    to: Address
    /** 最小单位，十进制字符串 */
    value: string
    validAfter: string
    validBefore: string
    nonce: Hex
  }
  signature: Hex
}

/**
 * 托管合约 EIP-712 OpenAuthorization：与 `openWithAuthorization` 参数一致；auth 字段须与 transferAuth.message 的 validAfter、validBefore、nonce 一致
 */
export interface OpenAuthEip712 {
  message: {
    payer: Address
    payee: Address
    token: Address
    /** 最小单位，十进制字符串（uint128） */
    deposit: string
    salt: Hex
    authorizedSigner: Address
    authValidAfter: string
    authValidBefore: string
    authNonce: Hex
  }
  signature: Hex
}

/**
 * Session Credential Payload（与 mppx `tempo/session/Types` 对齐：`voucher` / `close` 无 `type` 字段）
 */
export type SessionCredentialPayload =
  | {
      action: 'open'
      type: 'signature'
      channelId: Hex
      cumulativeAmount: string
      /** Voucher（累计支付承诺）签名 */
      signature: Hex
      transaction?: Hex
      /** 托管合约 OpenAuthorization 签名（与 transferAuth 配套） */
      openAuth: OpenAuthEip712
      transferAuth?: TransferAuthEip712
      authorizedSigner?: Address
    }
  | {
      action: 'voucher'
      channelId: Hex
      cumulativeAmount: string
      signature: Hex
    }
  | {
      action: 'close'
      channelId: Hex
      cumulativeAmount: string
      signature: Hex
    }

/** 与 mppx `sessionManager.close()` HTTP 分支返回的 `Payment-Receipt`（session 语义）一致 */
export type SessionCloseReceipt = TempoSession.Types.SessionReceipt

/**
 * Base Session Manager
 */
export interface BaseSessionManager {
  readonly opened: boolean
  readonly channelId: Hex | null
  readonly cumulative: bigint
  /** 与 `resolvedEscrow` / EIP-712 一致 */
  readonly chainId: number
  readonly escrowContract: Address

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** 与 `mppx` `sessionManager().close()` 一致：签 close 凭证并向 `fetch` 用过的 URL POST，解析 `Payment-Receipt` */
  close(): Promise<SessionCloseReceipt | undefined>
  /**
   * 链上调用托管合约 `requestClose(channelId)`（需已打开 channel）。
   * 不清理本地 channel、不调用 HTTP close；与 {@link close} 独立。
   */
  requestCloseOnChain(params: { rpcUrl: string }): Promise<{ txHash: Hex }>
  /**
   * 链上调用托管合约 `withdraw(channelId)`。须在链上 `requestClose` 且经过合约规定的等待期之后调用。
   * 可传 `channelId` 覆盖（例如 HTTP {@link close} 已清空本地 channel 后仍凭已知 id 提现）。
   */
  withdrawOnChain(params: { rpcUrl: string; channelId?: Hex }): Promise<{ txHash: Hex }>
}

/**
 * 创建 Base Session
 */
export function baseSession(params: BaseSessionParams): BaseSessionManager {
  const {
    account,
    maxDeposit = '1',
    decimals = 6,
    chainId = DEFAULT_CHAIN_ID,
    escrowContract,
    authorizedSigner,
    onChannelUpdate,
    acceptPayment = DEFAULT_ACCEPT_PAYMENT,
    fetchImpl = globalThis.fetch,
    onChallenge,
    onPaymentReceipt,
    usdcDomainRpcUrl,
  } = params

  const resolvedEscrow = escrowContract ?? DEFAULT_ESCROW_CONTRACT[chainId]
  const resolvedCurrency = DEFAULT_USDC[chainId]
  const resolvedAuthorizedSigner = authorizedSigner ?? account.address
  const maxDepositWei = parseUnits(maxDeposit, decimals)

  let channel: ChannelEntry | undefined
  /** 上一笔已成功 402 重试的 challenge（在 `fetch` 的 `notifyReceipt` 成功路径提交，供 `close()`） */
  let lastChallenge: Challenge.Challenge | undefined
  /** 与 mppx `sessionManager` 一致，供 `close()` 向同一资源提交 close 凭证 */
  let lastUrl: RequestInfo | URL | null = null

  async function createOpenCredential(
    challenge: Challenge.Challenge,
    initialAmount: bigint,
  ): Promise<string> {
    const payee = getAddress((challenge.request.recipient as string) ?? account.address)
    const deposit = maxDepositWei

    const transferNonce = randomBytes32()
    const validAfter = 0n
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600*24)

    const transferMessage: TransferWithAuthorizationMessage = {
      from: account.address,
      to: resolvedEscrow,
      value: deposit,
      validAfter,
      validBefore,
      nonce: transferNonce,
    }

    const transferAuthSignature = await signTransferWithAuthorization(
      account,
      transferMessage,
      chainId,
      resolvedCurrency,
      { rpcUrl: usdcDomainRpcUrl },
    )

    const salt = randomBytes32()
    const channelId = computeChannelId({
      payer: account.address,
      payee,
      token: resolvedCurrency,
      salt,
      authorizedSigner: resolvedAuthorizedSigner,
      escrowContract: resolvedEscrow,
      chainId,
    })

    channel = {
      channelId,
      salt,
      cumulativeAmount: initialAmount,
      escrowContract: resolvedEscrow,
      chainId,
      opened: true,
    }
    onChannelUpdate?.(channel)

    const openAuthSignature = await signOpenAuthorization(
      account,
      {
        payer: account.address,
        payee,
        token: resolvedCurrency,
        deposit,
        salt,
        authorizedSigner: resolvedAuthorizedSigner,
        authValidAfter: validAfter,
        authValidBefore: validBefore,
        authNonce: transferNonce,
      },
      { escrowContract: resolvedEscrow, chainId },
    )

    const voucherSignature = await signVoucher(account, {
      channelId,
      cumulativeAmount: initialAmount,
      escrowContract: resolvedEscrow,
      chainId,
    })

    const payload: SessionCredentialPayload = {
      action: 'open',
      type: 'signature',
      channelId,
      cumulativeAmount: initialAmount.toString(),
      signature: voucherSignature,
      openAuth: {
        message: {
          payer: account.address,
          payee,
          token: resolvedCurrency,
          deposit: deposit.toString(),
          salt,
          authorizedSigner: resolvedAuthorizedSigner,
          authValidAfter: validAfter.toString(),
          authValidBefore: validBefore.toString(),
          authNonce: transferNonce,
        },
        signature: openAuthSignature,
      },
      transferAuth: {
        message: {
          from: account.address,
          to: resolvedEscrow,
          value: deposit.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce: transferNonce,
        },
        signature: transferAuthSignature,
      },
      authorizedSigner: resolvedAuthorizedSigner,
    }
    console.error("open payload:", JSON.stringify(payload, null, 2));

    return Credential.serialize({ challenge, payload, source: `did:pkh:eip155:${chainId}:${account.address}` })
  }

  async function createVoucherCredential(
    challenge: Challenge.Challenge,
    cumulativeAmount: bigint,
  ): Promise<string> {
    if (!channel?.opened) {
      throw new Error('Channel not opened')
    }

    const signature = await signVoucher(account, {
      channelId: channel.channelId,
      cumulativeAmount,
      escrowContract: resolvedEscrow,
      chainId,
    })

    const payload: SessionCredentialPayload = {
      action: 'voucher',
      channelId: channel.channelId,
      cumulativeAmount: cumulativeAmount.toString(),
      signature,
    }
    console.error("voucher payload:", JSON.stringify(payload, null, 2));

    return Credential.serialize({ challenge, payload, source: `did:pkh:eip155:${chainId}:${account.address}` })
  }

  async function createCloseCredential(
    challenge: Challenge.Challenge,
    cumulativeAmount: bigint,
  ): Promise<string> {
    if (!channel?.opened) {
      throw new Error('Channel not opened')
    }
    const signature = await signVoucher(account, {
      channelId: channel.channelId,
      cumulativeAmount,
      escrowContract: resolvedEscrow,
      chainId,
    })
    const payload: SessionCredentialPayload = {
      action: 'close',
      channelId: channel.channelId,
      cumulativeAmount: cumulativeAmount.toString(),
      signature,
    }
    return Credential.serialize({
      challenge,
      payload,
      source: `did:pkh:eip155:${chainId}:${account.address}`,
    })
  }

  return {
    get opened() {
      return channel?.opened ?? false
    },

    get channelId() {
      return channel?.channelId ?? null
    },

    get cumulative() {
      return channel?.cumulativeAmount ?? 0n
    },

    get chainId() {
      return chainId
    },

    get escrowContract() {
      return resolvedEscrow
    },

    async fetch(input, init) {
      lastUrl = input
      const resolvedMethod =
        init?.method ?? (input instanceof Request ? input.method : 'POST')
      const effectiveInit: RequestInit | undefined =
        init !== undefined
          ? { ...init, method: resolvedMethod }
          : input instanceof Request
            ? undefined
            : { method: resolvedMethod }

      const callerHeaders = getCallerHeaders(input, effectiveInit?.headers)
      const hasExplicitAcceptPayment = callerHeaders.has('Accept-Payment')
      const initial = prepareInitialRequest(
        input,
        effectiveInit ? { ...effectiveInit } : undefined,
        callerHeaders,
        acceptPayment,
        hasExplicitAcceptPayment,
      )

      let response = await fetchImpl(initial.input, initial.init)

      const notifyReceipt = (res: Response) => {
        if (!res.ok) return
        const parsed = parsePaymentReceipt(res)
        if (parsed) onPaymentReceipt?.(parsed)
      }
      notifyReceipt(response)

      if (response.status !== 402) return response

      /**
       * 402 后重试：签名用将要达到的累计额，本地 `cumulativeAmount` / `lastChallenge` 仅在重试 `response.ok` 时提交
       *（见下方 `if (response.ok)`）。`open` 仍在 `createOpenCredential` 内建 `channel`；仅延后 `lastChallenge`。
       * `onChallenge` 若从不调用 `createCredential` 则不会登记 pending，成功时也不会自动提交。
       */
      let pendingPaymentCommit:
        | { kind: 'voucher'; nextCumulative: bigint; challenge: Challenge.Challenge }
        | { kind: 'open'; challenge: Challenge.Challenge }
        | undefined

      const challenges = Challenge.fromResponseList(response)
      const challenge = pickSessionChallenge(challenges)

      const createCredentialDefault = async (): Promise<string> => {
        const amount = BigInt(challenge.request.amount as string)
        if (!channel?.opened) {
          pendingPaymentCommit = { kind: 'open', challenge }
          return createOpenCredential(challenge, amount)
        }
        const nextCumulative = channel.cumulativeAmount + amount
        pendingPaymentCommit = { kind: 'voucher', nextCumulative, challenge }
        return createVoucherCredential(challenge, nextCumulative)
      }

      const credentialFromHook = onChallenge
        ? await onChallenge(challenge, { createCredential: createCredentialDefault })
        : undefined
      const credential = credentialFromHook ?? (await createCredentialDefault())
      validateCredentialHeaderValue(credential)

      const retryHeaders = withAuthorizationHeader(initial.headers, credential)
      const { context: _ctx, ...fetchInit } = (initial.init ?? {}) as RequestInit & {
        context?: unknown
      }

      response = await fetchImpl(initial.input, {
        ...fetchInit,
        headers: retryHeaders,
      })
      if (response.ok && pendingPaymentCommit) {
        if (pendingPaymentCommit.kind === 'voucher' && channel) {
          channel.cumulativeAmount = pendingPaymentCommit.nextCumulative
        }
        lastChallenge = pendingPaymentCommit.challenge
      }
      pendingPaymentCommit = undefined
      notifyReceipt(response)
      return response
    },

    async close() {
      const closeChallenge = lastChallenge
      const closeChannelId = channel?.channelId
      if (!channel?.opened || !closeChannelId) {
        return undefined
      }
      if (!closeChallenge) {
        throw new Error(
          'No challenge available. Complete a paid request (402) first so the session is bound to a challenge.',
        )
      }
      if (lastUrl == null) {
        throw new Error('No URL available — call fetch() before close().')
      }

      const cumulativeAmount = channel.cumulativeAmount
      const credential = await createCloseCredential(closeChallenge, cumulativeAmount)
      validateCredentialHeaderValue(credential)

      const response = await fetchImpl(lastUrl, {
        method: 'POST',
        headers: { Authorization: credential },
      })

      let sessionReceipt: SessionCloseReceipt | undefined
      const receiptHeader = response.headers.get('Payment-Receipt')
      if (receiptHeader?.trim()) {
        try {
          sessionReceipt = TempoSession.Receipt.deserializeSessionReceipt(receiptHeader.trim())
        } catch {
          sessionReceipt = undefined
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(
          `Close request failed with status ${response.status}${body ? `: ${body}` : ''}`,
        )
      }

      channel = undefined
      lastChallenge = undefined
      lastUrl = null

      return sessionReceipt
    },

    async requestCloseOnChain(params: { rpcUrl: string }) {
      const { rpcUrl } = params
      if (!rpcUrl?.trim()) {
        throw new Error('requestCloseOnChain requires a non-empty rpcUrl')
      }
      const closeChannelId = channel?.channelId
      if (!channel?.opened || !closeChannelId) {
        throw new Error(
          'Channel not opened — complete a paid mpp_fetch (402) first so channelId exists.',
        )
      }

      const chain = chainDefinitionForRpc(chainId, rpcUrl.trim())
      const walletClient = createWalletClient({
        account: account as Account,
        chain,
        transport: http(rpcUrl.trim()),
      })

      const txHash = await walletClient.writeContract({
        address: resolvedEscrow,
        abi: escrowChannelActionsAbi,
        functionName: 'requestClose',
        args: [closeChannelId],
      })
      return { txHash }
    },

    async withdrawOnChain(params: { rpcUrl: string; channelId?: Hex }) {
      const { rpcUrl, channelId: channelIdArg } = params
      if (!rpcUrl?.trim()) {
        throw new Error('withdrawOnChain requires a non-empty rpcUrl')
      }
      let withdrawChannelId: Hex
      if (channelIdArg) {
        withdrawChannelId = channelIdArg
      } else {
        if (!channel?.opened || !channel.channelId) {
          throw new Error(
            'Channel not opened — complete mpp_fetch (402) first, or pass channelId (e.g. after HTTP close cleared local state).',
          )
        }
        withdrawChannelId = channel.channelId
      }

      const chain = chainDefinitionForRpc(chainId, rpcUrl.trim())
      const walletClient = createWalletClient({
        account: account as Account,
        chain,
        transport: http(rpcUrl.trim()),
      })

      const txHash = await walletClient.writeContract({
        address: resolvedEscrow,
        abi: escrowChannelActionsAbi,
        functionName: 'withdraw',
        args: [withdrawChannelId],
      })

      channel = undefined
      lastChallenge = undefined
      lastUrl = null
      
      return { txHash }
    },
  }
}
