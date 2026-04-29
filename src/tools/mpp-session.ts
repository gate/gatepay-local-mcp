/**
 * MPP session 工具：init / fetch / close / request_close / withdraw（链上）
 * 使用本地 mpp-base 的 baseSession()（Base + USDC，authorize/open 分离）复用 channel
 * 缓存以 account.address 为 key，支持同一账户复用
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Account, Address, Hex } from "viem";
import { privateKeyToAccount, toAccount } from "viem/accounts";
import { baseSession } from "../mpp-base/index.js";
import { createQuickWalletSigner } from "../modes/signers/quick-wallet.js";
import {
  connectPluginWalletEvmForSigning,
  createPluginWalletSigner,
} from "../modes/signers/plugin-wallet.js";
import { runQuickWalletDeviceAuthIfNeeded } from "../modes/quick-wallet.js";
import { getMcpClient, getApiKey } from "../wallets/wallet-mcp-clients.js";
import { getPluginWalletClient } from "../wallets/plugin-wallet-client.js";
import { getEnvConfig, getMppBaseSessionChainId } from "../config/env-config.js";
import type { ClientEvmSigner } from "../x402/types.js";
import {
  getMppSession,
  setMppSession,
  clearMppSession,
  type MppSessionManager,
} from "./mpp-session-store.js";
import { buildRequestInit } from "../utils/validation.js";
import {
  createErrorResponse,
  createSuccessResponse,
  handleRequestError,
} from "../utils/response-helpers.js";
import { base, baseSepolia } from "viem/chains";

/** 供 baseSession / viem writeContract 使用的账户（本地私钥或托管 toAccount）。 */
export type MppBaseSessionAccount = Account;

/**
 * 解析 sign_mode：local_private_key、quick_wallet（托管 MCP + {@link createQuickWalletSigner}）、
 * plugin_wallet（浏览器插件 MCP + {@link createPluginWalletSigner} + viem {@link toAccount}）。
 */
async function resolveMppAccount(
  signMode: string | undefined,
  options: { walletLoginProvider: "google" | "gate" }
): Promise<MppBaseSessionAccount> {
  const mode = signMode ?? "local_private_key";
  if (mode === "local_private_key") {
    const rawKey = process.env.EVM_PRIVATE_KEY?.trim() ?? process.env.PRIVATE_KEY?.trim();
    if (!rawKey) {
      throw new Error("未设置 EVM_PRIVATE_KEY（或 PRIVATE_KEY），无法为 Base MPP 签名。");
    }
    const evmPrivateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
    return privateKeyToAccount(evmPrivateKey);
  }
  if (mode === "quick_wallet") {
    const envConfig = getEnvConfig();
    const serverUrl =
      process.env.QUICK_WALLET_SERVER_URL?.trim() || envConfig.quickWalletServerUrl;
    const apiKey = process.env.QUICK_WALLET_API_KEY?.trim() || getApiKey();
    const mcp = await getMcpClient({ serverUrl, apiKey });
    await runQuickWalletDeviceAuthIfNeeded(mcp, serverUrl, {
      walletLoginProvider: options.walletLoginProvider,
    });
    const signer = await createQuickWalletSigner(mcp, {
      gateMcpEvmChain: process.env.QUICK_WALLET_MPP_EVM_CHAIN?.trim() || "BASE",
      evmChainId: getMppBaseSessionChainId(),
    });
    if (!signer.signMessage || !signer.signTransaction) {
      throw new Error("createQuickWalletSigner: 缺少 signMessage/signTransaction，无法接入 MPP。");
    }
    return toAccount({
      address: signer.address,
      signMessage: ({ message }) => signer.signMessage!({ message }),
      signTypedData: (typedData) =>
        signer.signTypedData(
          typedData as Parameters<ClientEvmSigner["signTypedData"]>[0]
        ),
      signTransaction: (tx, opts) => signer.signTransaction!(tx, opts),
    });
  }
  if (mode === "plugin_wallet") {
    const envConfig = getEnvConfig();
    const pluginWalletBaseUrl = process.env.PLUGIN_WALLET_SERVER_URL ?? envConfig.pluginWalletServerUrl;
    const pluginWalletToken = process.env.PLUGIN_WALLET_TOKEN;
    const pluginWalletServerUrl = pluginWalletToken 
      ? `${pluginWalletBaseUrl}?token=${encodeURIComponent(pluginWalletToken)}`
      : undefined;
    const client = await getPluginWalletClient({ serverUrl: pluginWalletServerUrl });
    const address = await connectPluginWalletEvmForSigning(client);
    const signer = createPluginWalletSigner(client, address);
    if (!signer.signMessage || !signer.signTypedData || !signer.signTransaction) {
      throw new Error(
        "createPluginWalletSigner: 缺少 signMessage/signTypedData/signTransaction，无法接入 MPP。",
      );
    }
    return toAccount({
      address: signer.address,
      signMessage: ({ message }) => signer.signMessage!({ message }),
      signTypedData: (typedData) =>
        signer.signTypedData(
          typedData as Parameters<ClientEvmSigner["signTypedData"]>[0]
        ),
      signTransaction: (tx, opts) => signer.signTransaction!(tx, opts),
    });
  }
  throw new Error(
    `MPP Base 当前不支持 sign_mode=${mode}。可选：local_private_key、quick_wallet、plugin_wallet。`
  );
}

type MppLoadStrategy = "explicit" | "auto";

type MppLoadAttempt = {
  signMode: string;
  /** used = 本方式已用于当前 session；skipped = 未尝试（如未配置私钥）；failed = 已尝试但失败（仅 auto 链式靠后的方式会记录） */
  outcome: "used" | "skipped" | "failed";
  detail?: string;
};

function hasEvmPrivateKeyInEnv(): boolean {
  const raw = process.env.EVM_PRIVATE_KEY?.trim();
  return Boolean(raw);
}

/**
 * 解析账户与 sign_mode：显式 `sign_mode` 时只走该方式；否则按 local_private_key（仅当已配置 EVM 私钥）→ quick_wallet → plugin_wallet 级联，各地址不同故只建一条成功路径。
 */
async function resolveAccountForMppInit(
  explicitSignMode: string | undefined,
  walletLoginProvider: "google" | "gate"
): Promise<{
  account: MppBaseSessionAccount;
  effectiveSignMode: string;
  loadStrategy: MppLoadStrategy;
  loadAttempts: MppLoadAttempt[];
}> {
  if (explicitSignMode) {
    const account = await resolveMppAccount(explicitSignMode, { walletLoginProvider });
    return {
      account,
      effectiveSignMode: explicitSignMode,
      loadStrategy: "explicit",
      loadAttempts: [{ signMode: explicitSignMode, outcome: "used" }],
    };
  }

  const loadAttempts: MppLoadAttempt[] = [];

  if (hasEvmPrivateKeyInEnv()) {
    try {
      const account = await resolveMppAccount("local_private_key", { walletLoginProvider });
      loadAttempts.push({ signMode: "local_private_key", outcome: "used" });
      return {
        account,
        effectiveSignMode: "local_private_key",
        loadStrategy: "auto",
        loadAttempts,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `已设置 EVM_PRIVATE_KEY，但 local_private_key 无法加载: ${msg}`,
      );
    }
  }

  loadAttempts.push({
    signMode: "local_private_key",
    outcome: "skipped",
    detail: "未设置 EVM_PRIVATE_KEY",
  });

  try {
    const account = await resolveMppAccount("quick_wallet", { walletLoginProvider });
    loadAttempts.push({ signMode: "quick_wallet", outcome: "used" });
    return {
      account,
      effectiveSignMode: "quick_wallet",
      loadStrategy: "auto",
      loadAttempts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loadAttempts.push({ signMode: "quick_wallet", outcome: "failed", detail: msg });
  }

  if (!process.env.PLUGIN_WALLET_TOKEN?.trim()) {
    loadAttempts.push({
      signMode: "plugin_wallet",
      outcome: "failed",
      detail: "未设置 PLUGIN_WALLET_TOKEN",
    });
    const failedSummary = loadAttempts
      .filter((a) => a.outcome === "failed")
      .map((a) => `${a.signMode}: ${a.detail ?? ""}`);
    throw new Error(
      `未指定 sign_mode 时自动选择失败：无本地私钥，且 quick_wallet 未成功；plugin_wallet 需设置 PLUGIN_WALLET_TOKEN。${failedSummary.join("；")}`,
    );
  }

  try {
    const account = await resolveMppAccount("plugin_wallet", { walletLoginProvider });
    loadAttempts.push({ signMode: "plugin_wallet", outcome: "used" });
    return {
      account,
      effectiveSignMode: "plugin_wallet",
      loadStrategy: "auto",
      loadAttempts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loadAttempts.push({ signMode: "plugin_wallet", outcome: "failed", detail: msg });
  }

  const failedSummary = loadAttempts
    .filter((a) => a.outcome === "failed")
    .map((a) => `${a.signMode}: ${a.detail ?? ""}`);
  throw new Error(
    `未指定 sign_mode 时自动选择失败：无本地私钥，且 quick_wallet 与 plugin_wallet 均未成功。${failedSummary.join("；")}`,
  );
}

/**
 * Base session：chainId 来自 env-config（GATE_PAY_ENV + MPP_BASE_CHAIN_ID / BASE_CHAIN_ID 可选覆盖）；
 * 托管合约仅当显式设置 MPP_BASE_ESCROW_CONTRACT / BASE_ESCROW_CONTRACT 时覆盖 mpp-base 默认。
 */
function resolveBaseSessionEnv(): {
  chainId: number;
  escrowContract?: Address;
  usdcDomainRpcUrl?: string;
} {
  const chainId = getMppBaseSessionChainId();
  const escrowRaw =
    process.env.MPP_BASE_ESCROW_CONTRACT?.trim() ??
    process.env.BASE_ESCROW_CONTRACT?.trim();
  const rpcRaw =
    process.env.MPP_BASE_RPC_URL?.trim() ?? process.env.BASE_RPC_URL?.trim();

  const out: {
    chainId: number;
    escrowContract?: Address;
    usdcDomainRpcUrl?: string;
  } = { chainId };

  if (escrowRaw?.startsWith("0x")) {
    out.escrowContract = escrowRaw as Address;
  }
  if (rpcRaw) {
    out.usdcDomainRpcUrl = rpcRaw;
  }
  return out;
}

/**
 * MPP Base 链上写交易 RPC。
 * 优先级：MPP_BASE_RPC_URL、BASE_RPC_URL；可选入参 rpc_url 覆盖（见 mpp_request_close）。
 * Base 主网 / Sepolia 使用 viem 默认公共 URL；其他 chainId 须设置环境变量。
 */
function resolveMppBaseRpcUrl(chainId: number): string {
  const explicit =
    process.env.MPP_BASE_RPC_URL?.trim() ?? process.env.BASE_RPC_URL?.trim();
  if (explicit) return explicit;
  if (chainId === base.id) return base.rpcUrls.default.http[0]!;
  if (chainId === baseSepolia.id) return baseSepolia.rpcUrls.default.http[0]!;
  throw new Error(
    `未设置 MPP_BASE_RPC_URL（或 BASE_RPC_URL），且 chainId ${chainId} 无内置默认 RPC。`
  );
}

/**
 * mpp_init_session: 初始化 Base MPP session（SessionManager），以 account.address 为 key 缓存
 * - 显式 sign_mode：只加载该方式
 * - 未指定 sign_mode：有 EVM_PRIVATE_KEY/PRIVATE_KEY 则用 local_private_key，否则按 quick_wallet → plugin_wallet 尝试（成功即停）
 * - 若账户已存在：复用现有 SessionManager 实例，保持 channel 状态；否则创建新实例
 * - 成功响应含 loadStrategy（explicit|auto）与 loadAttempts 供 agent 了解加载过程
 */
export async function handleMppInitSession(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const maxDeposit = String(args.max_deposit ?? "1").trim();
    const signModeRaw = args.sign_mode != null ? String(args.sign_mode).trim() : "";
    const explicitSignMode = signModeRaw || undefined;
    const walletLoginProvider =
      args.wallet_login_provider === "google" || args.wallet_login_provider === "gate"
        ? args.wallet_login_provider
        : "gate";
    const decimals = args.decimals != null ? Number(args.decimals) : 6;
    const baseOpts = resolveBaseSessionEnv();

    const { account, effectiveSignMode, loadStrategy, loadAttempts } = await resolveAccountForMppInit(
      explicitSignMode,
      walletLoginProvider
    );
    const accountAddress = account.address.toLowerCase();

    // 检查是否已有该账户的 session
    const existing = getMppSession(accountAddress);
    if (existing) {
      // 检查 maxDeposit 是否变化，若变化则需重建实例
      if (existing.maxDeposit !== maxDeposit) {
        // 先关闭旧会话（清理 channel）
        clearMppSession(accountAddress);

        // 创建新的 SessionManager 实例（使用新 maxDeposit）
        const sessionManager = baseSession({
          // viem LocalAccount.signTypedData 与 mpp-base 的宽松签名在 TS 上不兼容，运行时一致
          account: account as never,
          maxDeposit,
          decimals,
          ...baseOpts,
        }) as unknown as MppSessionManager;

        // 重新存入缓存
        const newMeta = setMppSession(
          accountAddress,
          sessionManager,
          { signMode: effectiveSignMode, maxDeposit }
        );

        return createSuccessResponse(
          JSON.stringify(
            {
              sessionId: newMeta.sessionId,
              accountAddress: newMeta.accountAddress,
              signMode: newMeta.signMode,
              loadStrategy,
              loadAttempts,
              maxDeposit: newMeta.maxDeposit,
              phase: "reinit",
              previousMaxDeposit: existing.maxDeposit,
              message: `maxDeposit 从 ${existing.maxDeposit} 调整为 ${maxDeposit}，已重建 SessionManager，channel 已重置。`,
            },
            null,
            2
          )
        );
      }

      return createSuccessResponse(
        JSON.stringify(
          {
            sessionId: existing.sessionId,
            accountAddress: existing.accountAddress,
            signMode: existing.signMode,
            loadStrategy,
            loadAttempts,
            maxDeposit: existing.maxDeposit,
            phase: "reused",
            opened: existing.manager.opened,
            channelId: existing.manager.channelId ?? null,
            cumulative: existing.manager.cumulative.toString(),
            message: `复用已有会话（账户 ${accountAddress}）。SessionManager 已缓存，channel 状态保持。`,
          },
          null,
          2
        )
      );
    }

    // 创建新的 SessionManager（baseSession 返回带 fetch/close 的实例）
    const sessionManager = baseSession({
      account: account as never,
      maxDeposit,
      decimals,
      ...baseOpts,
    }) as unknown as MppSessionManager;

    // 存入缓存
    const meta = setMppSession(
      accountAddress,
      sessionManager,
      { signMode: effectiveSignMode, maxDeposit }
    );

    return createSuccessResponse(
      JSON.stringify(
        {
          sessionId: meta.sessionId,
          accountAddress: meta.accountAddress,
          signMode: meta.signMode,
          loadStrategy,
          loadAttempts,
          maxDeposit: meta.maxDeposit,
          phase: "initialized",
          opened: false,
          channelId: null,
          cumulative: "0",
          message:
            loadStrategy === "auto"
              ? `会话已初始化（自动选用 ${meta.signMode}）。首次 mpp_fetch 在收到 402 后会自动打开通道（channel）。loadAttempts 记录了级联过程。`
              : "会话已初始化。首次 mpp_fetch 发起请求并收到 402 后，会自动打开通道（channel）。",
        },
        null,
        2
      )
    );
  } catch (err) {
    return await handleRequestError(err);
  }
}

/**
 * mpp_fetch: 使用缓存的 SessionManager 发起请求（自动处理 402 + credential 重试）
 * - 自动查找任一已缓存的 session
 */
export async function handleMppFetch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const url = String(args.url ?? "").trim();
    if (!url || !url.startsWith("http")) {
      return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
    }

    // 查找任一已有 session
    const meta = getMppSession();
    if (!meta) {
      return createErrorResponse(
        "无活跃 MPP 会话。请先调用 mpp_init_session 初始化。"
      );
    }

    const method = String(args.method ?? "POST").trim().toUpperCase();
    const body = args.body != null ? String(args.body) : "";

    // 解析自定义 headers（可选）
    let extraHeaders: Record<string, string> = {};
    if (args.headers) {
      if (typeof args.headers === "string") {
        try {
          extraHeaders = JSON.parse(args.headers);
        } catch {
          return createErrorResponse("headers 必须是 JSON 对象字符串。");
        }
      } else if (typeof args.headers === "object" && args.headers !== null) {
        extraHeaders = args.headers as Record<string, string>;
      }
    }

    const init = buildRequestInit(method, body);
    const headers = new Headers(init.headers as HeadersInit | undefined);
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }

    // 使用 SessionManager.fetch（会自动处理 402 并带 credential 重试）
    const response = await meta.manager.fetch(url, {
      ...init,
      headers,
    });

    const responseText = await response.text();

    // SessionManager 返回的 response 带有 channelId、cumulative 等属性
    const channelId = (meta.manager as unknown as { channelId?: string }).channelId;
    const cumulative = (meta.manager as unknown as { cumulative?: bigint }).cumulative;

    return createSuccessResponse(
      JSON.stringify(
        {
          sessionId: meta.sessionId,
          accountAddress: meta.accountAddress,
          response: {
            status: response.status,
            statusText: response.statusText,
            body: responseText,
          },
          session: {
            opened: meta.manager.opened,
            channelId: channelId ?? null,
            cumulative: cumulative?.toString() ?? "0",
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    return await handleRequestError(err);
  }
}

/**
 * mpp_request_close: 链上调用托管合约 `requestClose(bytes32 channelId)`。
 * 不清理本地 session，与 HTTP `mpp_close_session` 独立。
 */
export async function handleMppRequestClose(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    const accountAddress =
      args.account_address != null
        ? String(args.account_address).trim().toLowerCase()
        : undefined;

    const meta = accountAddress ? getMppSession(accountAddress) : getMppSession();
    if (!meta) {
      return createErrorResponse(
        accountAddress
          ? `无活跃 MPP 会话（账户 ${accountAddress}）。请先调用 mpp_init_session。`
          : "无活跃 MPP 会话。请先调用 mpp_init_session。"
      );
    }

    const requestCloseOnChain = meta.manager.requestCloseOnChain;
    if (!requestCloseOnChain) {
      return createErrorResponse(
        "当前 SessionManager 不支持链上 requestClose（需使用 Base mpp-base 会话）。"
      );
    }

    const channelId = meta.manager.channelId;
    if (!channelId) {
      return createErrorResponse(
        "当前无 channelId。请先使用 mpp_fetch 完成一次 402 并打开通道后再请求链上 requestClose。"
      );
    }

    const chainId = meta.manager.chainId ?? resolveBaseSessionEnv().chainId;
    const rpcArg = args.rpc_url != null ? String(args.rpc_url).trim() : "";
    const rpcUrl = rpcArg || resolveMppBaseRpcUrl(chainId);

    const { txHash } = await requestCloseOnChain({ rpcUrl });

    return createSuccessResponse(
      JSON.stringify(
        {
          sessionId: meta.sessionId,
          accountAddress: meta.accountAddress,
          txHash,
          chainId,
          escrowContract: meta.manager.escrowContract ?? null,
          channelId,
          message:
            "已在托管合约上发送 requestClose 交易。本地 session 未清除；HTTP 结算请仍用 mpp_close_session。",
        },
        null,
        2
      )
    );
  } catch (err) {
    return await handleRequestError(err);
  }
}

const BYTES32_HEX_RE = /^0x[a-fA-F0-9]{64}$/;

/**
 * mpp_withdraw: 链上调用托管合约 `withdraw(bytes32 channelId)`，取回 requestClose 结算后的剩余资金。
 * 须在链上完成 `requestClose` 且经过合约规定的等待期之后调用（时机由合约 revert 约束）。
 */
export async function handleMppWithdraw(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const accountAddress =
      args.account_address != null
        ? String(args.account_address).trim().toLowerCase()
        : undefined;

    const meta = accountAddress ? getMppSession(accountAddress) : getMppSession();
    if (!meta) {
      return createErrorResponse(
        accountAddress
          ? `无活跃 MPP 会话（账户 ${accountAddress}）。请先调用 mpp_init_session。`
          : "无活跃 MPP 会话。请先调用 mpp_init_session。"
      );
    }

    const withdrawOnChain = meta.manager.withdrawOnChain;
    if (!withdrawOnChain) {
      return createErrorResponse(
        "当前 SessionManager 不支持链上 withdraw（需使用 Base mpp-base 会话）。"
      );
    }

    let channelIdArg: Hex | undefined;
    if (args.channel_id != null && String(args.channel_id).trim() !== "") {
      const raw = String(args.channel_id).trim();
      if (!BYTES32_HEX_RE.test(raw)) {
        return createErrorResponse(
          "channel_id 须为 bytes32：0x 前缀 + 64 位十六进制。省略时则使用当前会话中的 channelId（须通道仍在本地为已打开）。"
        );
      }
      channelIdArg = raw as Hex;
    } else {
      const channelId = meta.manager.channelId;
      if (!channelId) {
        return createErrorResponse(
          "当前无 channel_id：请先 mpp_fetch 打开通道，或在 HTTP close 清空本地状态后显式传入 channel_id。"
        );
      }
    }

    const chainId = meta.manager.chainId ?? resolveBaseSessionEnv().chainId;
    const rpcArg = args.rpc_url != null ? String(args.rpc_url).trim() : "";
    const rpcUrl = rpcArg || resolveMppBaseRpcUrl(chainId);

    const { txHash } = await withdrawOnChain({
      rpcUrl,
      channelId: channelIdArg,
    });

    const effectiveChannelId = channelIdArg ?? meta.manager.channelId;

    return createSuccessResponse(
      JSON.stringify(
        {
          sessionId: meta.sessionId,
          accountAddress: meta.accountAddress,
          txHash,
          chainId,
          escrowContract: meta.manager.escrowContract ?? null,
          channelId: effectiveChannelId,
          message:
            "已在托管合约上发送 withdraw 交易。须此前已在链上 requestClose 且已过合约等待期；否则交易会 revert。",
        },
        null,
        2
      )
    );
  } catch (err) {
    return await handleRequestError(err);
  }
}

/**
 * mpp_close_session: 关闭通道并返回结算信息
 * - 使用 SessionManager.close() 执行链上结算
 */
export async function handleMppCloseSession(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    // 支持可选的 accountAddress 参数
    const accountAddress = args.account_address != null
      ? String(args.account_address).trim().toLowerCase()
      : undefined;

    let meta;
    if (accountAddress) {
      meta = getMppSession(accountAddress);
    } else {
      // 无参数则关闭任意一个
      meta = getMppSession();
    }

    if (!meta) {
      return createErrorResponse(
        accountAddress
          ? `无活跃 MPP 会话（账户 ${accountAddress}）。请先调用 mpp_init_session。`
          : "无活跃 MPP 会话。请先调用 mpp_init_session。"
      );
    }

    const targetAddress = meta.accountAddress;
    const sessionId = meta.sessionId;

    // 调用 SessionManager.close() 执行链上结算
    let receipt = null;
    let closeError = null;
    try {
      const closeResult = await meta.manager.close();
      receipt = closeResult ? {
        channelId: (closeResult as { channelId?: string }).channelId,
        acceptedCumulative: (closeResult as { acceptedCumulative?: string }).acceptedCumulative,
        spent: (closeResult as { spent?: string }).spent,
        txHash: (closeResult as { txHash?: string }).txHash,
        timestamp: (closeResult as { timestamp?: string }).timestamp,
      } : null;
    } catch (err) {
      closeError = err instanceof Error ? err.message : String(err);
    }

    // 清理该账户的 session
    clearMppSession(targetAddress);

    return createSuccessResponse(
      JSON.stringify(
        {
          sessionId,
          accountAddress: targetAddress,
          closed: true,
          receipt,
          error: closeError,
          message: closeError
            ? `关闭出错：${closeError}`
            : receipt
              ? `会话已关闭，结算完成。channelId: ${receipt.channelId}, 结算额: ${receipt.acceptedCumulative}`
              : "会话已清理（可能未正式打开通道）。",
        },
        null,
        2
      )
    );
  } catch (err) {
    return await handleRequestError(err);
  }
}
