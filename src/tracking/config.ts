/**
 * 火山引擎 DataFinder 埋点配置。
 * 产品常量复用 getTrackingConfig()，本模块补充队列/刷新/调试等运行时参数。
 */
import { getTrackingConfig, type TrackingConfig as BaseTrackingConfig } from "../config/env-config.js";

export interface VolcTrackerConfig {
  /** 是否启用上报 */
  enabled: boolean;
  /** 完整上报 URL（https://${host}/v2/event/list） */
  endpoint: string;
  /** X-MCS-AppKey */
  appKey: string;
  /** 应用 ID（数字） */
  appId: number;
  /** 触发立即 flush 的队列长度阈值，范围 [1, 50] */
  batchSize: number;
  /** 定时 flush 间隔（毫秒） */
  flushIntervalMs: number;
  /** 进程退出时等待 flush 的最长时间（毫秒） */
  shutdownTimeoutMs: number;
  /** 是否打印调试日志到 stderr */
  debug: boolean;
  /** 队列硬上限，超出丢弃新事件 */
  queueCap: number;
  /** 火山 HTTP 请求超时（毫秒） */
  fetchTimeoutMs: number;
}

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_MS = 5000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1000;
const QUEUE_CAP = 1000;
const FETCH_TIMEOUT_MS = 5000;

function clampBatchSize(raw: number): number {
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(raw, 50);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let _config: VolcTrackerConfig | undefined;

export function getVolcTrackerConfig(): VolcTrackerConfig {
  if (_config) return _config;

  const base = getTrackingConfig();
  const host = base.reportHost;

  _config = {
    enabled: base.enabled,
    endpoint: `https://${host}/v2/event/list`,
    appKey: base.appKey,
    appId: base.appId,
    batchSize: clampBatchSize(parsePositiveInt(process.env.VOLC_TRACKING_BATCH_SIZE, DEFAULT_BATCH_SIZE)),
    flushIntervalMs: parsePositiveInt(process.env.VOLC_TRACKING_FLUSH_MS, DEFAULT_FLUSH_MS),
    shutdownTimeoutMs: parsePositiveInt(process.env.VOLC_TRACKING_SHUTDOWN_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS),
    debug: process.env.VOLC_TRACKING_DEBUG?.trim().toLowerCase() === "true",
    queueCap: QUEUE_CAP,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
  };

  return _config;
}

/** 仅测试用：重置缓存配置 */
export function resetVolcTrackerConfig(): void {
  _config = undefined;
}
