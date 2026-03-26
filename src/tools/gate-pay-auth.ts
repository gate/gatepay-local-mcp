import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runGatePayDeviceAuthIfNeeded } from "../gate-pay/auth.js";
import { getGatePayAccessToken } from "../gate-pay/pay-token-store.js";
import { createErrorResponse, createSuccessResponse } from "../utils/response-helpers.js";

export async function handleGatePayAuth(): Promise<CallToolResult> {
  try {
    const phase = await runGatePayDeviceAuthIfNeeded();
    const token = getGatePayAccessToken();
    const masked =
      token && token.length > 12
        ? `${token.slice(0, 8)}...${token.slice(-4)}`
        : token
          ? "***"
          : null;

    return createSuccessResponse(
      JSON.stringify(
        {
          status: phase === "login_succeeded" ? "authorized" : "ready",
          summary:
            phase === "already_authenticated"
              ? "进程内已有有效 Gate Pay access_token（中心化支付）。"
              : "Gate Pay 设备流登录成功，已保存 access_token。",
          gate_pay_access_token_masked: masked,
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
