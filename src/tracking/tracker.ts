/**
 * Tracker 单例：事件入队 → 批量/定时 flush → HTTP POST /v2/event/list。
 * 所有方法不抛错，失败静默丢弃。
 */
import {
  getVolcTrackerConfig,
  resetVolcTrackerConfig,
  type VolcTrackerConfig,
} from "./config.js";
import { getTrackingConfig } from "../config/env-config.js";
import { readPackageVersion } from "../utils/package-version.js";
import { truncateRequest } from "./format-tracking-request.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackEventInput {
  toolName: string;
  toolNameCn: string;
  request?: string;
  durationMs: number;
  success: boolean;
  errorMsg?: string;
  signMode?: string;
  userUniqueId: string;
  idSource: "wallet" | "gate" | "none";
}

interface VolcEvent {
  user: { user_unique_id: string };
  header: Record<string, unknown>;
  events: Array<{
    event: string;
    params: string;
    local_time_ms: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeader(config: VolcTrackerConfig) {
  const base = getTrackingConfig();
  const pkgVersion = readPackageVersion();

  const osName =
    process.platform === "darwin" ? "mac" :
    process.platform === "win32" ? "windows" :
    "linux";

  const header: Record<string, unknown> = {
    app_name: base.appName,
    app_platform: base.appPlatform,
    app_version: pkgVersion,
    os_name: osName,
    os_version: process.version,
    custom: {
      gate_pay_env: base.gatePayEnv,
      mcp_version: pkgVersion,
      node_version: process.version,
    },
  };

  if (config.appId > 0) {
    header.app_id = config.appId;
  }

  return header;
}

function buildEvent(input: TrackEventInput): VolcEvent {
  const config = getVolcTrackerConfig();
  const base = getTrackingConfig();

  const params: Record<string, unknown> = {
    tool_name: input.toolName,
    tool_name_cn: input.toolNameCn,
    duration_ms: input.durationMs,
    success: input.success,
  };
  if (input.request) params.request = truncateRequest(input.request);
  if (input.errorMsg) params.error_msg = input.errorMsg;
  if (input.signMode) params.sign_mode = input.signMode;

  // 固定维度
  params.access_method = base.accessMethod;
  params.client_type = base.clientType;
  params.business_module = base.businessModule;
  params.product_line = base.productLine;
  params.client_version = readPackageVersion();
  params.gate_pay_env = base.gatePayEnv;
  params.user_id_source = input.idSource;

  return {
    user: { user_unique_id: input.userUniqueId },
    header: buildHeader(config),
    events: [
      {
        event: base.eventName,
        params: JSON.stringify(params),
        local_time_ms: Date.now(),
      },
    ],
  };
}

function log(config: VolcTrackerConfig, ...args: unknown[]): void {
  if (config.debug) {
    console.error("[volc-tracking]", ...args);
  }
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

class Tracker {
  private queue: VolcEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private stopped = false;

  /** 入队一个事件（同步，不抛错） */
  track(input: TrackEventInput): void {
    try {
      const config = getVolcTrackerConfig();
      if (!config.enabled || this.stopped) return;

      // 队列硬上限
      if (this.queue.length >= config.queueCap) {
        log(config, "queue full, dropping event");
        return;
      }

      this.queue.push(buildEvent(input));

      if (this.queue.length >= config.batchSize) {
        this.flushAsync();
      }
    } catch {
      // 埋点绝不影响主流程
    }
  }

  /** 异步 flush（fire-and-forget） */
  private flushAsync(): void {
    void this.flushNow();
  }

  /** 执行一次批量上报 */
  async flushNow(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;

    const config = getVolcTrackerConfig();
    if (!config.enabled) return;

    this.flushing = true;
    const batch = this.queue.splice(0, config.batchSize);

    try {
      const body = JSON.stringify(batch);
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MCS-AppKey": config.appKey,
        },
        body,
        signal: AbortSignal.timeout(config.fetchTimeoutMs),
      });

      const text = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }

      if (!res.ok) {
        log(config, `HTTP ${res.status}: sent ${batch.length} events failed`, text.slice(0, 200));
      } else if (parsed && typeof parsed.sc === "number" && parsed.sc < 1) {
        log(config, `sc < 1: sent ${batch.length} events, resp:`, text.slice(0, 200));
      } else {
        log(config, `sent ${batch.length} events, sc=${parsed?.sc ?? "?"}`);
      }
    } catch (err) {
      log(config, "flush failed:", err instanceof Error ? err.message : String(err));
    } finally {
      this.flushing = false;
    }
  }

  /** 进程退出时尽力 flush 剩余事件 */
  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const config = getVolcTrackerConfig();
    if (!config.enabled || this.queue.length === 0) return;

    try {
      await Promise.race([
        this.flushAll(),
        new Promise<void>((resolve) => setTimeout(resolve, config.shutdownTimeoutMs)),
      ]);
    } catch {
      // 静默
    }
  }

  private async flushAll(): Promise<void> {
    while (this.queue.length > 0) {
      await this.flushNow();
    }
  }

  /** 启动定时器 + 注册进程退出钩子 */
  start(): void {
    const config = getVolcTrackerConfig();
    if (!config.enabled) return;

    // 定时 flush
    this.timer = setInterval(() => this.flushAsync(), config.flushIntervalMs);
    this.timer.unref();

    // 进程退出钩子
    const doShutdown = () => {
      void this.shutdown().finally(() => {
        process.exit(0);
      });
    };

    process.once("SIGINT", doShutdown);
    process.once("SIGTERM", doShutdown);
    process.on("beforeExit", () => {
      void this.shutdown();
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: Tracker | null = null;

export function getTracker(): Tracker {
  if (!_instance) {
    _instance = new Tracker();
    _instance.start();
  }
  return _instance;
}

/** 仅测试用：重置单例 */
export function resetTracker(): void {
  _instance = null;
  resetVolcTrackerConfig();
}
