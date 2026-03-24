import { getGatePayAccessToken, isGatePayTokenUsable } from "./pay-token-store.js";
import { loginWithGatePayDeviceFlow } from "./device-flow.js";

export type GatePayAuthPhase = "already_authenticated" | "login_succeeded";

/**
 * 若进程内已有有效 Gate Pay access_token 则跳过；否则走 HTTP 设备流登录。
 */
export async function runGatePayDeviceAuthIfNeeded(): Promise<GatePayAuthPhase> {
  if (isGatePayTokenUsable()) {
    return "already_authenticated";
  }

  console.error("[Gate Pay] 无有效 access_token，开始设备流授权…");

  const ok = await loginWithGatePayDeviceFlow();
  if (!ok) {
    throw new Error(
      "Gate Pay 授权未完成（取消、失败、超时或缺少 GATE_PAY_DEVICE_* / PAY_GATE_DEVICE_* 配置）",
    );
  }

  if (!getGatePayAccessToken()) {
    throw new Error("Gate Pay 授权成功但未写入 access_token");
  }

  return "login_succeeded";
}
