/**
 * MPP session 工具：init / fetch / close
 * 使用 mppx tempo.session() 返回的 SessionManager 实现多轮请求复用 channel
 * 缓存以 account.address 为 key，支持同一账户复用
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { tempo } from "mppx/client";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

/**
 * 解析 sign_mode 与环境变量，返回 viem account。
 * 首期仅支持 local_private_key（EVM_PRIVATE_KEY）。
 */
function resolveMppAccount(signMode: string | undefined): ReturnType<typeof privateKeyToAccount> {
  const mode = signMode ?? "local_private_key";
  if (mode !== "local_private_key") {
    throw new Error(
      `MPP Tempo 当前仅支持 local_private_key（EVM_PRIVATE_KEY）。` +
        `quick_wallet / plugin_wallet 暂未实现（需将托管钱包封装为 viem Account）。`
    );
  }
  const rawKey = process.env.EVM_PRIVATE_KEY?.trim() ?? process.env.PRIVATE_KEY?.trim();
  if (!rawKey) {
    throw new Error("未设置 EVM_PRIVATE_KEY（或 PRIVATE_KEY），无法为 Tempo MPP 签名。");
  }
  const evmPrivateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  return privateKeyToAccount(evmPrivateKey);
}

/**
 * mpp_init_session: 初始化 Tempo session（SessionManager），以 account.address 为 key 缓存
 * - 若账户已存在：复用现有 SessionManager 实例，保持 channel 状态
 * - 若不存在：创建新实例
 */
export async function handleMppInitSession(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const maxDeposit = String(args.max_deposit ?? "1").trim();
    const signMode = args.sign_mode != null ? String(args.sign_mode).trim() : undefined;
    const decimals = args.decimals != null ? Number(args.decimals) : 6;

    const account = resolveMppAccount(signMode ?? "local_private_key");
    const accountAddress = account.address.toLowerCase();

    // 检查是否已有该账户的 session
    const existing = getMppSession(accountAddress);
    if (existing) {
      // 检查 maxDeposit 是否变化，若变化则需重建实例
      if (existing.maxDeposit !== maxDeposit) {
        // 先关闭旧会话（清理 channel）
        clearMppSession(accountAddress);

        // 创建新的 SessionManager 实例（使用新 maxDeposit）
        const sessionManager = tempo.session({
          account,
          maxDeposit,
          decimals,
        }) as unknown as MppSessionManager;

        // 重新存入缓存
        const newMeta = setMppSession(
          accountAddress,
          sessionManager,
          { signMode: signMode ?? "local_private_key", maxDeposit }
        );

        return createSuccessResponse(
          JSON.stringify(
            {
              sessionId: newMeta.sessionId,
              accountAddress: newMeta.accountAddress,
              signMode: newMeta.signMode,
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

    // 创建新的 SessionManager（tempo.session 返回带 fetch/close 的实例）
    const sessionManager = tempo.session({
      account,
      maxDeposit,
      decimals,
    }) as unknown as MppSessionManager;

    // 存入缓存
    const meta = setMppSession(
      accountAddress,
      sessionManager,
      { signMode: signMode ?? "local_private_key", maxDeposit }
    );

    return createSuccessResponse(
      JSON.stringify(
        {
          sessionId: meta.sessionId,
          accountAddress: meta.accountAddress,
          signMode: meta.signMode,
          maxDeposit: meta.maxDeposit,
          phase: "initialized",
          opened: false,
          channelId: null,
          cumulative: "0",
          message:
            "会话已初始化。首次 mpp_fetch 发起请求并收到 402 后，会自动打开通道（channel）。",
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
