# Design Document

## 0. SDK 选型与背景

### 0.1 为什么不用 Web/JS SDK

用户最初提供的链接 https://www.volcengine.com/docs/6285/93209 是火山 **Web/JS SDK 集成**，它依赖 `window`、`document`、`navigator`、`localStorage` 等浏览器全局，**不能跑在 Node.js stdio 进程里**。

### 0.2 为什么不用 Golang / Java / PHP SDK

[火山服务端 SDK 列表](https://www.volcengine.com/docs/6285/152564) 只提供 Java / PHP / Golang，**没有 Node.js SDK**。

### 0.3 最终选型：HTTP API

直接调用火山 [HTTP API](https://www.volcengine.com/docs/6285/152564)：

```
POST https://${host}/v2/event/list     # 批量，每批次 ≤ 50 条
POST https://${host}/v2/event/json     # 单条
Headers:
  Content-Type: application/json
  X-MCS-AppKey: <App Key>
```

理由：

- 零依赖：Node 22 内置 `fetch` 直接用，避免在已经很重的 deps 列表里再加东西；
- 跨平台：HTTP 协议本身和 Node 版本无关，未来升级到 Bun/Deno 也能跑；
- 易调试：可以用 curl 直接复现，火山响应里的 `sc`（成功条数）和 `m`（错误信息）一目了然；
- 完全可控：批量、超时、限流、降级策略我们自己决定，不被 SDK 黑盒约束。

### 0.4 关键的"主站误报到分站"约束

[Lark 分站埋点上报规范](https://gtglobal.jp.larksuite.com/wiki/TD03wA761iGrgFkks2AjgYh9pUg) 明确指出：

> 在当前 Finder 埋点上报的过程中，出现主站埋点数据错误上报至其他分站埋点的问题。经技术排查与分析，确定该问题的核心根源为**埋点上报时对应的 appid 错误**。

所以本设计的硬约束：

1. App Key/App Id **全部从环境变量读取**，代码默认值仅作为开箱即用的兜底（默认指向主站 gateio `10000001`）；
2. 部署方可以通过 `.env` 覆盖到任意分站，**不需要改代码**；
3. 上报地址（host）同理可覆盖，方便后续切到私有化。

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│            src/index.ts (MCP stdio server entrypoint)        │
│                                                              │
│  setRequestHandler(CallToolRequestSchema, async (req) => {   │
│    return await withTracking(req, async () => {              │
│        // 现有 if/else if 分发逻辑（不动）                    │
│    });                                                       │
│  })                                                          │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│         src/tracking/with-tracking.ts                        │
│  - 记录 start                                                 │
│  - 调原 handler                                               │
│  - 从 args / result 中安全提取 wallet address / sign_mode     │
│  - 把事件入队（不 await HTTP）                                 │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│         src/tracking/tracker.ts (Tracker singleton)          │
│  - in-memory queue                                            │
│  - 定时 flush (setInterval, unref)                            │
│  - 满 batch 立即 flush                                        │
│  - SIGINT/SIGTERM/beforeExit 同步 flush                       │
│  - flush() => POST /v2/event/list                            │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│         src/tracking/config.ts                               │
│  - 解析所有 VOLC_TRACKING_* 环境变量                          │
│  - 提供 isEnabled() / endpoint() / appKey() / appId()        │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│         src/tracking/identity.ts                             │
│  - resolveUserId(args, result): wallet → device_id           │
│  - 本地 device_id 读写（~/.gatepay-mcp/device_id）           │
│  - 进程级 memory fallback                                     │
└──────────────────────────────────────────────────────────────┘
```

四个文件都放在新建目录 `src/tracking/`，与现有 `src/utils/`、`src/config/` 解耦，方便后续移除/替换。

---

## 2. 文件级设计

### 2.1 `src/tracking/config.ts`

```ts
import { getEnvironment } from "../config/env-config.js";

export interface TrackingConfig {
  enabled: boolean;
  endpoint: string;          // 完整 URL：https://${host}/v2/event/list
  appKey: string;            // X-MCS-AppKey
  appId: string;             // header.custom.app_id
  batchSize: number;         // ≤ 50
  flushIntervalMs: number;
  shutdownTimeoutMs: number;
  debug: boolean;
}

const DEFAULT_HOST = "gator.volces.com";
const DEFAULT_APP_KEY = "dd447b6237008363f06bd97bbd4a27e0"; // gateio 主站
const DEFAULT_APP_ID = "10000001";                          // gateio 主站

export function getTrackingConfig(): TrackingConfig { ... }
```

- 所有读取都走 `process.env.X?.trim()`；
- `enabled` 综合 `VOLC_TRACKING_ENABLED !== "false"` 且 `appKey` 非空；
- `batchSize` 强制夹紧到 `[1, 50]` 范围。

### 2.2 `src/tracking/identity.ts`

```ts
export function resolveUserId(
  args: Record<string, unknown> | undefined,
  result: unknown,
): { userUniqueId: string; idSource: "wallet" | "device" };

function getOrCreateDeviceId(): string;
```

`resolveUserId` 字段提取优先级（按 12 个工具的 args/result 调研结果归纳）：

1. `args.from`、`args.payer`、`args.account_address`（x402 / mpp 系列）
2. result body 中 JSON parse 后的 `accountAddress`、`address`、`wallet_address`
3. 进程级 `process.env.EVM_PRIVATE_KEY` 派生地址（不解密时跳过，避免每次调 viem）—— 设计上**不**做这一步，免得把私钥意外引入 tracking 路径
4. fallback 到 `getOrCreateDeviceId()`

`getOrCreateDeviceId`：

```
path = path.join(os.homedir(), ".gatepay-mcp", "device_id")
try:
  if exists(path): return read(path)
  id = crypto.randomUUID().replace(/-/g, "")
  mkdir -p path的父目录
  write(path, id)
  return id
catch:
  // 只读容器 / 权限不足
  return MEMORY_FALLBACK_ID  // 模块级 const = randomUUID()
```

返回值最长 32 位，确保符合火山对 string 类型字段的常规限制。

### 2.3 `src/tracking/tracker.ts`

事件结构（火山 list 接口的 body 形态）：

```ts
interface VolcEvent {
  user: { user_unique_id: string };
  header: {
    app_name: "gatepay_local_mcp";
    app_platform: "server";
    app_version: string;          // package.json.version
    os_name: "mac" | "linux" | "windows";
    os_version: string;
    custom: {
      app_id: string;
      gate_pay_env: "test" | "prd";
      mcp_version: string;
      node_version: string;
      user_id_source: "wallet" | "device";
    };
  };
  events: Array<{
    event: "mcp_tool_call";
    params: string;               // JSON.stringify 的字符串（火山要求 single-level JSON map）
    local_time_ms: number;
  }>;
}
```

Tracker 类核心 API：

```ts
class Tracker {
  track(event: TrackEventInput): void;   // 同步入队，永不抛
  flushNow(): Promise<void>;             // 用于测试与进程退出
  shutdown(): Promise<void>;             // 注册到 SIGINT/SIGTERM/beforeExit
}

interface TrackEventInput {
  userUniqueId: string;
  idSource: "wallet" | "device";
  toolName: string;
  durationMs: number;
  success: boolean;
  errorMsg?: string;
  signMode?: string;
}
```

`track()` 逻辑：

1. 若 `config.enabled === false`，直接 return；
2. 把每个 input 转成「**一个 events 数组只含 1 个事件的 VolcEvent**」，原因：不同调用的 `user_unique_id` 不同，必须按 user 分单（火山 list 接口允许批量 user，每个 user 一个 body 对象，最多 50 个 body 对象一批）；
3. push 到队列；
4. 若长度 ≥ `batchSize`，立即触发异步 `flush()`（不 await）。

`flush()` 逻辑：

1. 取出队列前 `batchSize` 个事件作为本批；
2. `fetch(endpoint, { method: "POST", headers, body: JSON.stringify(batch), signal: AbortSignal.timeout(5000) })`；
3. 解析响应：`{ message, sc }`；
4. DEBUG 模式打印；
5. **失败丢弃，不重试**（避免事故场景下放大流量；如果未来需要持久化重试，再加文件队列）。

定时器：`setInterval(flush, flushIntervalMs).unref()` —— `unref()` 让定时器不阻塞 Node 退出。

退出处理：

```ts
process.on("SIGINT", () => shutdown().finally(() => process.exit(130)));
process.on("SIGTERM", () => shutdown().finally(() => process.exit(143)));
process.on("beforeExit", () => shutdown());
```

`shutdown()` 用 `Promise.race([flushAll(), sleep(shutdownTimeoutMs)])`。

模块单例：用 module-scope `let trackerInstance: Tracker | null = null` + `getTracker()` 工厂，避免热重载场景重复初始化。

### 2.4 `src/tracking/with-tracking.ts`

```ts
import { getTracker } from "./tracker.js";
import { resolveUserId } from "./identity.js";

export async function withTracking<T>(
  toolName: string,
  args: Record<string, unknown> | undefined,
  exec: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  let success = true;
  let errorMsg: string | undefined;
  let result: T | undefined;
  try {
    result = await exec();
    // 工具层约定：错误也走 createErrorResponse 返回，不抛
    // 通过 inspect result 的 isError 字段判断业务失败
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
      getTracker().track({
        userUniqueId,
        idSource,
        toolName,
        durationMs: Date.now() - start,
        success,
        errorMsg: success ? undefined : truncate(errorMsg, 500),
        signMode: typeof args?.sign_mode === "string" ? args.sign_mode : undefined,
      });
    } catch {
      // 埋点绝不影响主流程
    }
  }
}
```

`isMcpErrorResult`：复用 `src/utils/response-helpers.ts` 中 `createErrorResponse` 写入的形状（`{ content: [...], isError: true }`）。

`truncate`：避免 error_msg 把整个 stack trace 都送上火山。

### 2.5 `src/index.ts` 改动

只改一处：在中央 dispatcher 外面包一层。改动前：

```ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "x402_place_order") return await handlePlaceOrder(args ?? {});
  if (name === "x402_sign_payment") return await handleSignPayment(args ?? {}, signModeRegistry);
  // ... 12 个 if
  return createErrorResponse(`未知工具: ${name}`);
});
```

改动后：

```ts
import { withTracking } from "./tracking/with-tracking.js";
import { getTracker } from "./tracking/tracker.js";

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return await withTracking(name, args, async () => {
    if (name === "x402_place_order") return await handlePlaceOrder(args ?? {});
    if (name === "x402_sign_payment") return await handleSignPayment(args ?? {}, signModeRegistry);
    // ... 完全照抄原来的 12 个 if
    return createErrorResponse(`未知工具: ${name}`);
  });
});

// 在 main() 最后一步、 server.connect 之前注册一次：
getTracker(); // 触发实例化 + 注册退出钩子
```

`handle*` 函数体一律 **不动**，零侵入。

### 2.6 `.env.example` 追加

```
# ─────────────────────────────────────────────────────────────
# 火山引擎 DataFinder 埋点上报（可选）
# 文档：https://www.volcengine.com/docs/6285/152564
# 站点 appid 列表：见 Lark 分站埋点上报规范
# ─────────────────────────────────────────────────────────────

# 总开关，默认 true。置 false 完全不发请求。
# VOLC_TRACKING_ENABLED=true

# 上报域名（不含协议、不含末尾斜杠）。SaaS 默认 gator.volces.com；
# 私有化部署请联系火山平台人员确认。
# VOLC_TRACKING_HOST=gator.volces.com

# X-MCS-AppKey。默认主站 gateio。切到分站时务必同时改 APP_ID。
# VOLC_TRACKING_APP_KEY=dd447b6237008363f06bd97bbd4a27e0

# 上报的 app_id（数字字符串），同步用于排查归属。默认 10000001 (gateio 主站)。
# VOLC_TRACKING_APP_ID=10000001

# 批量与刷新（默认 20 / 5000ms / 1000ms）
# VOLC_TRACKING_BATCH_SIZE=20
# VOLC_TRACKING_FLUSH_MS=5000
# VOLC_TRACKING_SHUTDOWN_TIMEOUT_MS=1000

# 调试日志（默认关闭，开启后会把上报请求/响应打到 stderr）
# VOLC_TRACKING_DEBUG=false
```

---

## 3. 关键流程时序

### 3.1 一次成功的工具调用

```
MCP host        index.ts          handleX           Tracker         火山 HTTP
   │ CallTool       │                 │                 │              │
   │───────────────▶│                 │                 │              │
   │                │ withTracking    │                 │              │
   │                │────────────────▶│                 │              │
   │                │                 │ ... 业务 ...     │              │
   │                │◀────────────────│ result          │              │
   │                │ track() 入队     │                 │              │
   │                │────────────────────────────────▶│              │
   │◀───────────────│ 返回 result（同步）              │              │
   │                                                  │ 满 batch 或定时│
   │                                                  │─────────────▶│
   │                                                  │◀─────────────│
```

**关键点**：`track()` 是同步入队，HTTP 上报和返回值完全解耦，调用方无感。

### 3.2 进程退出

```
SIGTERM ─▶ shutdown() ─▶ 同步 flush ─▶ Promise.race([fetch, sleep(1000)]) ─▶ exit
```

最坏情况：1s 内未发完的事件丢弃，避免阻塞进程退出。

---

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 上报失败导致主流程报错 | `try { track() } catch {}` 双层兜底；config 解析也加 try/catch |
| 私钥/凭证泄漏 | `identity.ts` 只接受 wallet address 字段；`with-tracking.ts` 不把 args 整体上报，只白名单提取 `sign_mode` |
| 错把主站事件报到分站 | 默认值显式硬编码主站 `10000001`；切换分站强制改两个变量（KEY+ID）；启动时 DEBUG 打印当前 `app_id` |
| stdio 进程被频繁拉起拉灭导致事件丢失 | 退出钩子做同步 flush；同时火山 list 接口允许丢弃单批，损失可接受 |
| Node `fetch` 在 Node <18 不可用 | `package.json.engines` 未约束 Node 版本，但项目 deps（viem 2.x、@modelcontextprotocol/sdk 1.x）已经要求 ≥ Node 18。本设计正式约束 Node ≥ 18 |
| 队列无限增长 | 队列硬上限 1000 条，超出时丢弃新事件（DEBUG 打日志），避免内存膨胀 |
| 高频调用打爆火山限流 | 默认 5s/批 + 20 条/批 = 4 条/秒，远低于限流阈值；可通过环境变量调高 |

---

## 5. 测试策略

由于不引入新依赖，复用现有 `node --import tsx --test` 体系：

- `test/tracking/config.test.ts` — 解析默认值 / 覆盖值 / `ENABLED=false` 短路；
- `test/tracking/identity.test.ts` — wallet 字段优先级、device_id 持久化、只读 fs 时 fallback；
- `test/tracking/tracker.test.ts` — 用 `globalThis.fetch = mockFetch` 替换；验证批量边界、定时 flush、错误吞掉；
- `test/tracking/with-tracking.integration.test.ts` — 跑一遍真实 `handlePlaceOrder`（断网情况下也不抛错）；
- 手动验证脚本 `test/tracking/manual-send.ts`：跑一次真实 HTTP 上报到火山 SaaS，确认 `sc=1`。

---

## 6. 后续可扩展点（本期不做）

- 持久化重试队列（写入 `~/.gatepay-mcp/queue/*.ndjson`）；
- 区分 `mcp_tool_call_start` / `mcp_tool_call_end` 双事件以便算实时漏斗；
- 在 `mpp_session` 内部增加阶段事件（402 触发 / channel 打开 / 链上 tx 提交）；
- 把订单号、channelId 作为火山「业务对象」上报（`__item_set` + `__items`）。
