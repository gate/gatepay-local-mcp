import { getGatePayAccessToken, isGatePayTokenUsable } from "./pay-token-store.js";
import { loginWithGatePayDeviceFlow } from "./device-flow.js";

export type GatePayAuthPhase = "already_authenticated" | "login_succeeded";

/**
 * 若进程内已有有效 Gate Pay access_token 则跳过；否则走浏览器 OAuth（localhost 回调 + 远程换 token）。
 */
export async function runGatePayDeviceAuthIfNeeded(): Promise<GatePayAuthPhase> {
  if (isGatePayTokenUsable()) {
    return "already_authenticated";
  }

  console.error("[Gate Pay] 无有效 access_token，开始 OAuth 授权（本地回调 + 远程换 token）…");

  const ok = await loginWithGatePayDeviceFlow();
  if (!ok) {
    throw new Error(
      "Gate Pay 授权未完成（取消、失败、超时或远程换 token 失败）",
    );
  }

  if (!getGatePayAccessToken()) {
    throw new Error("Gate Pay 授权成功但未写入 access_token");
  }

  return "login_succeeded";
}
