import {
  ensureGatePayAccessTokenFresh,
  getGatePayAccessToken,
  getGatePayUserId,
  isGatePayTokenUsable,
} from "./pay-token-store.js";
import { loginWithGatePayDeviceFlow } from "./device-flow.js";

export type GatePayAuthPhase = "already_authenticated" | "login_succeeded";

/** `ensureGatePayAccessTokenAndUid` 成功时的 access_token、用户 id 与是否本次新登录 */
export interface GatePayAuthResult {
  accessToken: string;
  uid: string;
  phase: GatePayAuthPhase;
}

/**
 * 若进程内已有有效 Gate Pay access_token（含临近过期时用 refresh_token 刷新）则跳过；
 * 否则走浏览器 OAuth（localhost 回调 + 远程换 token）。
 */
export async function runGatePayDeviceAuthIfNeeded(): Promise<GatePayAuthPhase> {
  await ensureGatePayAccessTokenFresh();
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

/**
 * 若进程内已有有效 Gate Pay access_token（含 refresh）则直接返回 token 与 uid；
 * 否则走与 `runGatePayDeviceAuthIfNeeded` 相同的浏览器 OAuth，完成后返回 token 与 uid。
 */
export async function ensureGatePayAccessTokenAndUid(): Promise<GatePayAuthResult> {
  const phase = await runGatePayDeviceAuthIfNeeded();
  const accessToken = getGatePayAccessToken();
  if (!accessToken) {
    throw new Error("Gate Pay 授权后仍无 access_token");
  }
  return {
    accessToken,
    uid: getGatePayUserId() ?? "",
    phase,
  };
}
