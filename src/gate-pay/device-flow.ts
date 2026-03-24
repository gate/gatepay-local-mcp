/**
 * Gate Pay 设备授权流：通过 HTTP 调用支付侧 OAuth 接口（不使用 MCP）。
 * 环境变量（优先 GATE_PAY_*，兼容旧名 PAY_GATE_*）：
 *   GATE_PAY_DEVICE_START_URL — 启动设备流（默认 POST JSON，返回 flow_id / verification_url 等）
 *   GATE_PAY_DEVICE_POLL_URL  — 轮询（默认 POST JSON { flow_id }）
 * 可选：GATE_PAY_DEVICE_API_KEY — 若设置则作为 x-api-key 发往上述请求
 */

import { spawn } from "node:child_process";
import { setGatePayAccessToken } from "./pay-token-store.js";

function envStartUrl(): string | undefined {
  const u =
    process.env.GATE_PAY_DEVICE_START_URL?.trim() ||
    process.env.PAY_GATE_DEVICE_START_URL?.trim();
  return u || undefined;
}

function envPollUrl(): string | undefined {
  const u =
    process.env.GATE_PAY_DEVICE_POLL_URL?.trim() ||
    process.env.PAY_GATE_DEVICE_POLL_URL?.trim();
  return u || undefined;
}

function envApiKey(): string | undefined {
  const k =
    process.env.GATE_PAY_DEVICE_API_KEY?.trim() ||
    process.env.PAY_GATE_DEVICE_API_KEY?.trim();
  return k || undefined;
}

function computeExpiresAtMs(
  login: { expires_in?: number; expired_at?: number } | undefined,
  poll: { expires_in?: number },
): number {
  if (login && typeof login.expired_at === "number" && login.expired_at > 0) {
    return login.expired_at > 1e12 ? login.expired_at : login.expired_at * 1000;
  }
  const sec = login?.expires_in ?? poll.expires_in;
  if (typeof sec === "number" && sec > 0) {
    return Date.now() + sec * 1000;
  }
  return Date.now() + 30 * 86_400_000;
}

async function openBrowser(url: string): Promise<boolean> {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(cmd, [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    console.error("");
    console.error(`\x1b[33m⚠  Could not open browser automatically.\x1b[0m`);
    console.error(`   Copy URL: \x1b[36m${url}\x1b[0m`);
    console.error("");
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const key = envApiKey();
  if (key) headers["x-api-key"] = key;
  return headers;
}

export type GatePayDeviceFlowResult = boolean;

/**
 * 执行 Gate Pay HTTP 设备流，成功后写入 gate-pay-token-store。
 */
export async function loginWithGatePayDeviceFlow(): Promise<GatePayDeviceFlowResult> {
  const startUrl = envStartUrl();
  const pollUrl = envPollUrl();
  if (!startUrl || !pollUrl) {
    console.error(
      "[Gate Pay] 缺少环境变量 GATE_PAY_DEVICE_START_URL 或 GATE_PAY_DEVICE_POLL_URL（或旧名 PAY_GATE_*），无法启动授权。",
    );
    return false;
  }

  console.error("[Gate Pay] Starting device authorization (HTTP, no MCP)...");

  let startRes: Response;
  try {
    startRes = await fetch(startUrl, {
      method: "POST",
      headers: buildAuthHeaders(),
      body: "{}",
    });
  } catch (err) {
    console.error(`[Gate Pay] Start request failed: ${(err as Error).message}`);
    return false;
  }

  if (!startRes.ok) {
    const t = await startRes.text();
    console.error(`[Gate Pay] Start HTTP ${startRes.status}: ${t.slice(0, 500)}`);
    return false;
  }

  let parsed: {
    flow_id?: string;
    verification_url?: string;
    user_code?: string;
    expires_in?: number;
    interval?: number;
  };
  try {
    parsed = (await startRes.json()) as typeof parsed;
  } catch {
    console.error("[Gate Pay] Start response is not JSON");
    return false;
  }

  if (!parsed?.verification_url || !parsed?.flow_id) {
    console.error("[Gate Pay] Invalid start response (need flow_id + verification_url)");
    return false;
  }

  const intervalMs = (parsed.interval ?? 5) * 1000;
  const expiresInSec = parsed.expires_in ?? 1800;
  const deadline = Date.now() + expiresInSec * 1000;

  console.error(`[Gate Pay] flow_id: ${parsed.flow_id}`);
  console.error(`[Gate Pay] poll interval: ${intervalMs / 1000}s, expires_in: ${expiresInSec}s`);
  if (parsed.user_code) {
    console.error(`[Gate Pay] user_code: ${parsed.user_code}`);
  }

  const opened = await openBrowser(parsed.verification_url);
  if (opened) {
    console.error("[Gate Pay] Browser opened — please authorize.");
  }

  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
  };
  process.once("SIGINT", onSigint);

  let pollCount = 0;
  while (Date.now() < deadline && !cancelled) {
    await sleep(intervalMs);
    pollCount += 1;
    const remainingSec = Math.round((deadline - Date.now()) / 1000);
    console.error(
      `[Gate Pay] [poll #${pollCount}] POST poll — ~${remainingSec}s left`,
    );

    let pollRes: Response;
    try {
      pollRes = await fetch(pollUrl, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ flow_id: parsed.flow_id }),
      });
    } catch (err) {
      console.warn(`[Gate Pay] Poll failed: ${(err as Error).message} — retry`);
      continue;
    }

    let poll: {
      status: string;
      error?: string;
      access_token?: string;
      mcp_token?: string;
      user_id?: string;
      expires_in?: number;
      login_result?: {
        access_token?: string;
        mcp_token?: string;
        user_id?: string;
        expires_in?: number;
        expired_at?: number;
      };
    };

    try {
      poll = (await pollRes.json()) as typeof poll;
    } catch {
      console.error(`[Gate Pay] Poll #${pollCount}: non-JSON body`);
      continue;
    }

    if (!poll?.status) {
      continue;
    }

    console.error(
      `[Gate Pay] [poll #${pollCount}] status: ${poll.status}${poll.error ? ` error=${poll.error}` : ""}`,
    );

    if (poll.status === "ok") {
      const login = poll.login_result;
      const token =
        poll.access_token ??
        login?.access_token ??
        login?.mcp_token ??
        poll.mcp_token;
      const userId = login?.user_id ?? poll.user_id;
      if (token) {
        const expiresAtMs = computeExpiresAtMs(login, poll);
        setGatePayAccessToken(token, expiresAtMs);
        process.removeListener("SIGINT", onSigint);
        console.error("[Gate Pay] Authorized; access_token stored.");
        if (userId) console.error(`[Gate Pay] user_id: ${userId}`);
        return true;
      }
    }

    if (poll.status === "error") {
      process.removeListener("SIGINT", onSigint);
      console.error(`[Gate Pay] Error: ${poll.error ?? "unknown"}`);
      return false;
    }
  }

  process.removeListener("SIGINT", onSigint);
  console.error(cancelled ? "[Gate Pay] Cancelled" : "[Gate Pay] Timed out");
  return false;
}
