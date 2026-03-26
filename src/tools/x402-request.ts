import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeX402RequestInput } from "../modes/input-normalizer.js";
import type { createSignModeRegistry } from "../modes/registry.js";
import { formatSignModeSelectionError } from "../modes/registry.js";
import { buildRequestInit } from "../utils/validation.js";
import {
  createErrorResponse,
  handleRequestError,
  handleResponseWithBalanceCheck,
  isCallToolResult,
} from "../utils/response-helpers.js";

const TOOL_NAME = "x402_request";

async function validateToolRequest(name: string, args: unknown): Promise<CallToolResult | null> {
  if (name !== TOOL_NAME) {
    return createErrorResponse(`未知工具: ${name}. 仅支持 ${TOOL_NAME}。`);
  }

  const normalized = normalizeX402RequestInput((args ?? {}) as Record<string, unknown>);
  if (!normalized.url || !normalized.url.startsWith("http")) {
    return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
  }

  return null;
}

async function selectSignModeAndGetPayFetch(
  registry: ReturnType<typeof createSignModeRegistry>,
  signMode: string | undefined,
  walletLoginProvider: "google" | "gate"
): Promise<{ payFetch: typeof fetch } | CallToolResult> {
  try {
    const selectedMode = await registry.selectMode(signMode);
    const payFetch: typeof fetch = await registry.getOrCreatePayFetch(selectedMode.mode, {
      walletLoginProvider,
    });
    return { payFetch };
  } catch (error) {
    return createErrorResponse(formatSignModeSelectionError(error));
  }
}

async function executeX402Request(
  payFetch: typeof fetch,
  normalized: ReturnType<typeof normalizeX402RequestInput>
): Promise<CallToolResult> {
  try {
    const init = buildRequestInit(normalized.method, normalized.body);
    const response = await payFetch(normalized.url, init);
    const responseText = await response.text();
    return await handleResponseWithBalanceCheck(response, responseText);
  } catch (error) {
    if (error instanceof Error && error.message.includes("不支持的 method")) {
      return createErrorResponse(error.message);
    }
    throw error;
  }
}

/**
 * Legacy x402_request tool handler
 * @internal - Not exposed in public tool list, kept for backward compatibility
 */
export async function handleX402Request(
  args: Record<string, unknown>,
  signModeRegistry: ReturnType<typeof createSignModeRegistry>
): Promise<CallToolResult> {
  const validationError = await validateToolRequest(TOOL_NAME, args);
  if (validationError) {
    return validationError;
  }

  const normalized = normalizeX402RequestInput((args ?? {}) as Record<string, unknown>);

  const signModeResult = await selectSignModeAndGetPayFetch(
    signModeRegistry,
    normalized.signMode,
    normalized.walletLoginProvider
  );

  if (isCallToolResult(signModeResult)) {
    return signModeResult;
  }

  const payFetch = signModeResult.payFetch;

  try {
    const result = await executeX402Request(payFetch, normalized);
    return result;
  } catch (err) {
    return await handleRequestError(err);
  }
}
