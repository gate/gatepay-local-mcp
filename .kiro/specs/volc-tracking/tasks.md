# Implementation Tasks

> 任务粒度按"一个 PR 一条任务"组织。每条任务后括号里标注对应的 requirements / design 章节。

## Phase 1：核心实现（必做）

- [ ] **T1. 新建 `src/tracking/config.ts`**（Req 4 / Req 7 / Design §2.1）
  - 读取 `VOLC_TRACKING_*` 全部环境变量
  - 默认值：host=`gator.volces.com`、appKey=主站 key、appId=`10000001`、batchSize=20、flushMs=5000、shutdownTimeoutMs=1000、debug=false
  - `batchSize` 强制夹紧到 `[1, 50]`
  - 暴露 `getTrackingConfig(): TrackingConfig`

- [ ] **T2. 新建 `src/tracking/identity.ts`**（Req 3 / Design §2.2）
  - `resolveUserId(args, result)`：按白名单字段提取 wallet address
  - `getOrCreateDeviceId()`：`~/.gatepay-mcp/device_id` 读写 + 进程级 memory fallback
  - **不**触碰 `EVM_PRIVATE_KEY` 等敏感字段

- [ ] **T3. 新建 `src/tracking/tracker.ts`**（Req 1 / Req 5 / Req 6 / Design §2.3）
  - `Tracker` 类：`track() / flushNow() / shutdown()`
  - 内部队列（硬上限 1000 条防膨胀）
  - 满 batch 立即 flush + `setInterval.unref()` 定时 flush
  - `POST /v2/event/list`，`AbortSignal.timeout(5000)`，失败丢弃
  - 注册 `SIGINT/SIGTERM/beforeExit` 钩子
  - 模块单例 `getTracker()`
  - DEBUG 日志输出到 stderr

- [ ] **T4. 新建 `src/tracking/with-tracking.ts`**（Req 1 / Design §2.4）
  - `withTracking<T>(toolName, args, exec)` 包装函数
  - 复用 `response-helpers.ts` 中 `createErrorResponse` 的 `isError` 形状判断业务失败
  - error message 截断到 500 字符
  - 双层 try/catch 保证埋点不影响主流程

- [ ] **T5. 修改 `src/index.ts`**（Req 1 / Design §2.5）
  - import `withTracking` 和 `getTracker`
  - 中央 dispatcher 外面包一层 `withTracking(name, args, async () => { ...原 12 个 if... })`
  - `main()` 末尾、`server.connect(stdio)` 之前调一次 `getTracker()` 触发实例化与退出钩子注册
  - **不**改动任何 `handle*` 函数体

- [ ] **T6. 追加 `.env.example`**（Req 4 / Design §2.6）
  - 在文件末尾新增「火山引擎 DataFinder 埋点上报（可选）」章节
  - 全部环境变量都注释掉，附中文说明 + 默认值说明
  - 显式注释提示「切到分站时务必同时改 APP_ID 和 APP_KEY」

## Phase 2：测试与验证（强烈建议）

- [ ] **T7. 单测 `test/tracking/config.test.ts`**（Req 4 / Design §5）
  - 默认值
  - 环境变量覆盖
  - `ENABLED=false` 短路
  - `batchSize` 夹紧

- [ ] **T8. 单测 `test/tracking/identity.test.ts`**（Req 3 / Design §5）
  - 各字段优先级
  - 临时目录 + 真实文件 IO 验证 device_id 持久化
  - 模拟只读 fs 时 fallback 不抛错

- [ ] **T9. 单测 `test/tracking/tracker.test.ts`**（Req 5 / Req 6 / Design §5）
  - `globalThis.fetch` 替换为 mock，断言请求 URL / headers / body
  - 满 batch 立即触发
  - 定时器触发
  - 上报失败不抛
  - 队列硬上限

- [ ] **T10. 手动验证脚本 `test/tracking/manual-send.ts`**（Design §5）
  - 直接调一次真实火山 SaaS
  - 在 README 增加运行说明
  - 跑通后在 DataFinder「数据治理」里能看到事件

## Phase 3：文档与上线（必做）

- [ ] **T11. 在 `Readme.md` 增加「埋点上报」一节**
  - 说明默认会上报到 gateio 主站，可关闭
  - 列出全部 `VOLC_TRACKING_*` 环境变量
  - 链接到 Lark 分站埋点上报规范

- [ ] **T12. 联系数据团队确认**
  - 主站 gateio appid `10000001` 是否接受 `gatepay_local_mcp` 这个 `app_name`
  - 是否需要在火山后台预创建 `mcp_tool_call` 事件元数据
  - 如需切到分站，对齐分站 owner

## 不在本期范围

- 持久化重试队列
- start/end 双事件
- mpp-session/x402 内部阶段事件
- 业务对象上报（订单号 / channelId 作为 item）

---

## 估时（粗略）

| 任务 | 估时 |
|---|---|
| T1 ~ T5 核心实现 | 0.5 ~ 1 天 |
| T6 .env.example | 0.5 小时 |
| T7 ~ T9 单测 | 0.5 ~ 1 天 |
| T10 手动验证 | 半天（依赖能否拿到一个测试 appid） |
| T11 文档 | 1 小时 |
| T12 跨团队确认 | 1 ~ 3 天异步等待 |

合计净开发 ≈ 2 ~ 2.5 天，关键路径在 T12（数据团队确认）。
