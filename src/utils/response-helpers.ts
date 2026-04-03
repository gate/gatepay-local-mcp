import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { containsInsufficientBalanceSignal, buildInsufficientBalanceReply } from "./balance-check.js";

export function createErrorResponse(message: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function createSuccessResponse(text: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text }],
    isError: false,
  };
}

export function formatResponseText(responseText: string): string {
  try {
    const json = JSON.parse(responseText) as { data?: unknown };
    return json.data != null
      ? JSON.stringify(json.data, null, 2)
      : JSON.stringify(json, null, 2);
  } catch {
    return responseText;
  }
}

export async function handleResponseWithBalanceCheck(
  response: Response,
  responseText: string
): Promise<CallToolResult> {
  const text = formatResponseText(responseText);
  const insufficientBalance =
    containsInsufficientBalanceSignal(responseText) ||
    containsInsufficientBalanceSignal(text);

  if (!response.ok && response.status !== 402) {
    if (insufficientBalance) {
      return createErrorResponse(await buildInsufficientBalanceReply(text));
    }
    return createErrorResponse(`HTTP ${response.status}: ${text}`);
  }

  if (insufficientBalance) {
    return createErrorResponse(await buildInsufficientBalanceReply(text));
  }

  return createSuccessResponse(text);
}

export async function handleRequestError(err: unknown): Promise<CallToolResult> {
  const message = err instanceof Error ? err.message : String(err);
  if (containsInsufficientBalanceSignal(message)) {
    return createErrorResponse(await buildInsufficientBalanceReply(message));
  }
  const hint =
    message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")
      ? " 请确认 url 可访问；402 支付需托管钱包已登录且有足够余额。"
      : "";
  return createErrorResponse(`请求失败: ${message}.${hint}`);
}

export function isCallToolResult(result: unknown): result is CallToolResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as CallToolResult).content)
  );
}
