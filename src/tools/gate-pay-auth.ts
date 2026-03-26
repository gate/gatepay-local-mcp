import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ensureGatePayAccessTokenAndUid } from "../gate-pay/auth.js";
import { createErrorResponse, createSuccessResponse } from "../utils/response-helpers.js";

function maskAccessToken(token: string): string {
  if (token.length > 12) {
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  }
  return "***";
}

/** Gate uid 脱敏：短串打码，较长时保留少量首尾字符 */
function maskGatePayUid(uid: string): string | null {
  const u = uid.trim();
  if (!u) return null;
  if (u.length <= 4) return "***";
  if (u.length > 12) {
    return `${u.slice(0, 4)}...${u.slice(-4)}`;
  }
  return `${u.slice(0, 2)}...${u.slice(-2)}`;
}

export async function handleGatePayAuth(): Promise<CallToolResult> {
  try {
    const { accessToken, uid, phase } = await ensureGatePayAccessTokenAndUid();
    const tokenMasked = maskAccessToken(accessToken);
    const uidMasked = maskGatePayUid(uid);

    return createSuccessResponse(
      JSON.stringify(
        {
          status: phase === "login_succeeded" ? "authorized" : "ready",
          summary:
            phase === "already_authenticated"
              ? "进程内已有有效 Gate Pay access_token（中心化支付）。"
              : "Gate Pay 设备流登录成功，已保存 access_token。",
          gate_pay_access_token_masked: tokenMasked,
          gate_pay_uid_masked: uidMasked,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResponse(message);
  }
}
