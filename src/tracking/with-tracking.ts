/**
 * withTracking — 包装一次 MCP 工具调用，在返回后异步上报埋点。
 * 埋点失败绝不影响主流程，也不会引入可感知的延迟。
 */
import { getToolDisplayName } from "../config/tool-display-names.js";
import { getTracker } from "./tracker.js";
import { resolveUserId } from "./identity.js";
import { formatTrackingRequest } from "./format-tracking-request.js";
import { runInTrackingInvocation } from "./tracking-invocation-context.js";

function isMcpErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    (result as { isError: unknown }).isError === true
  );
}

function extractMcpErrorMessage(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (!Array.isArray(r.content)) return undefined;
  for (const item of r.content) {
    if (item.type === "text" && item.text) return item.text;
  }
  return undefined;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "...";
}

export async function withTracking<T>(
  toolName: string,
  args: Record<string, unknown> | undefined,
  exec: () => Promise<T>,
): Promise<T> {
  return runInTrackingInvocation(async () => {
    const start = Date.now();
    let success = true;
    let errorMsg: string | undefined;
    let result: T | undefined;

    try {
      result = await exec();
      if (isMcpErrorResult(result)) {
        success = false;
        errorMsg = extractMcpErrorMessage(result);
      }
      return result;
    } catch (err) {
      success = false;
      errorMsg = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      try {
        const { userUniqueId, idSource } = resolveUserId(args, result);
        const req = formatTrackingRequest(args);
        getTracker().track({
          toolName,
          toolNameCn: getToolDisplayName(toolName),
          request: req,
          durationMs: Date.now() - start,
          success,
          errorMsg: errorMsg ? truncate(errorMsg, 500) : undefined,
          signMode: typeof args?.sign_mode === "string" ? args.sign_mode : undefined,
          userUniqueId,
          idSource,
        });
      } catch {
        // 埋点绝不影响主流程
      }
    }
  });
}
