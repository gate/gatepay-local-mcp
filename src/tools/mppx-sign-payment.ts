import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Mppx, tempo } from "mppx/client";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildRequestInit } from "../utils/validation.js";
import {
  createErrorResponse,
  handleRequestError,
  handleResponseWithBalanceCheck,
} from "../utils/response-helpers.js";

function pickOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

/** Optional JSON object for tempo/session manual credential (action, channelId, cumulativeAmount, …). */
function parseMppSessionContext(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return undefined;
    try {
      const parsed: unknown = JSON.parse(s);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type TempoClientParameters = NonNullable<Parameters<typeof tempo>[0]>;

function buildTempoParameters(
  account: ReturnType<typeof privateKeyToAccount>,
  args: Record<string, unknown>
): TempoClientParameters {
  const params: TempoClientParameters = { account };
  const maxDeposit =
    pickOptionalString(args.mpp_tempo_max_deposit) ?? "1";
  if (maxDeposit) params.maxDeposit = maxDeposit;
  return params;
}

/**
 * MPP (WWW-Authenticate) paywall: parse challenge, sign, and resubmit the merchant request.
 */
export async function handleMppxSignPayment(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const url = String(args.url ?? "").trim();
    const method = String(args.method ?? "POST").trim().toUpperCase();
    const body = args.body != null ? String(args.body) : "";
    const wwwAuthenticate = String(args.www_authenticate_header ?? "").trim();
    const responseBody = args.response_body != null ? String(args.response_body) : "";

    if (!url || !url.startsWith("http")) {
      return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
    }

    if (!wwwAuthenticate) {
      return createErrorResponse(
        "缺少 www_authenticate_header：mppx 需要从 402 响应的 WWW-Authenticate 解析 Payment challenge。"
      );
    }

    const rawKey = process.env.EVM_PRIVATE_KEY?.trim() ?? process.env.PRIVATE_KEY?.trim();
    if (!rawKey) {
      return createErrorResponse("未设置 EVM_PRIVATE_KEY（或 PRIVATE_KEY），无法为 Tempo MPP 签名。");
    }
    const evmPrivateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
    const account = privateKeyToAccount(evmPrivateKey);

    const tempoParams = buildTempoParameters(account, args);
    const mppx = Mppx.create({
      methods: [tempo(tempoParams)],
      polyfill: false,
    });

    const challengeResponse = new Response(responseBody || null, {
      status: 402,
      statusText: "Payment Required",
      headers: {
        "WWW-Authenticate": wwwAuthenticate,
        ...(responseBody ? { "Content-Type": "application/json" } : {}),
      },
    });

    const credential = await mppx.createCredential(challengeResponse);
    const init = buildRequestInit(method, body);
    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set("Authorization", credential);

    const response = await fetch(url, { ...init, headers });
    const responseText = await response.text();
    return await handleResponseWithBalanceCheck(response, responseText);
  } catch (err) {
    return await handleRequestError(err);
  }
}
