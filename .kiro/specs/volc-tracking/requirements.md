# Requirements Document

## Introduction

为 `gatepay-local-mcp` 的所有 MCP 工具调用接入火山引擎增长分析（DataFinder）埋点上报，用于度量工具使用频次、耗时、成败、签名模式分布等关键指标。由于 `gatepay-local-mcp` 是以 stdio 形态运行的 Node.js 后端进程（由 MCP host 拉起为子进程），火山官方未提供 Node.js SDK，所以直接调用火山 HTTP API。

需特别遵守 [分站埋点上报规范](https://gtglobal.jp.larksuite.com/wiki/TD03wA761iGrgFkks2AjgYh9pUg)：

- `appid` 与 `X-MCS-AppKey` 必须严格对应所属站点，禁止主站误报到分站；
- 配置必须可被部署方覆盖，避免硬编码导致后续无法切换站点。

## Requirements

### Requirement 1：统一的埋点上报入口

**Objective:** As a 数据消费方 (PM / 数据分析), I want 所有 MCP 工具调用都被埋点上报到火山, so that 能在 DataFinder 看板里统一分析工具使用情况

#### Acceptance Criteria

1. When `src/index.ts` 的 `CallToolRequestSchema` handler 处理任意工具调用, the Tracking Layer shall 在该调用结束后异步上报一条 `mcp_tool_call` 事件。
2. The Tracking Layer shall 对当前已注册的 12 个工具（`x402_place_order`、`x402_sign_payment`、`mpp_init_session`、`mpp_fetch`、`mpp_close_session`、`mpp_request_close`、`mpp_withdraw`、`x402_create_signature`、`x402_submit_payment`、`x402_gate_pay_auth`、`x402_quick_wallet_auth`、`x402_centralized_payment`、`x402_request`）全部生效，无需在每个 handler 内重复埋点。
3. When 工具调用抛出异常, the Tracking Layer shall 仍上报一条带有 `success=false` 与 `error_msg` 字段的事件。
4. The Tracking Layer shall 永远不影响主流程：上报失败、网络异常、配置缺失等情况下绝不向上抛错，也不阻塞工具响应。
5. The Tracking Layer shall 在工具响应已返回给 MCP host 之后再异步触发 HTTP 上报，避免给调用方引入额外延迟。

### Requirement 2：上报字段与最小事件模型

**Objective:** As a 数据分析师, I want 每条上报事件携带统一字段, so that 可以按工具、签名模式、耗时、环境进行下钻

#### Acceptance Criteria

1. The Tracking Layer shall 上报事件名固定为 `mcp_tool_call`。
2. The Tracking Layer shall 在 `params` 中至少包含 `tool_name`、`duration_ms`、`success`、`error_msg`（仅失败时）、`sign_mode`（若调用参数中携带）。
3. The Tracking Layer shall 在 `header.custom` 中携带 `mcp_version`（取自 `package.json.version`）、`gate_pay_env`（test/prd）、`node_version`、`os`。
4. The Tracking Layer shall 在 `header` 中设置 `app_name="gatepay_local_mcp"`、`app_platform="server"`、`os_name` 按运行平台映射为 `mac`/`linux`/`windows`。
5. The Tracking Layer shall 在 `events[].local_time_ms` 写入事件结束时的毫秒 Unix 时间戳。

### Requirement 3：用户身份解析

**Objective:** As a 数据分析师, I want 同一钱包的调用能聚合到同一个用户身份, so that 可以做留存与漏斗分析

#### Acceptance Criteria

1. When 当次工具调用能解析出 EVM/SVM wallet address, the Tracking Layer shall 使用 `lowercase(wallet_address)` 作为 `user_unique_id`。
2. When 当次调用拿不到 wallet address, the Tracking Layer shall fallback 使用本地匿名 device_id 作为 `user_unique_id`。
3. The Tracking Layer shall 在 `~/.gatepay-mcp/device_id` 持久化本地 device_id；文件不存在时随机生成 32 位十六进制串并写入。
4. If 文件系统不可写（只读容器、权限问题等）, then the Tracking Layer shall fallback 到进程级内存 device_id（同一进程内稳定，进程重启后变化），并继续工作不抛错。
5. The Tracking Layer shall 不上报任何明文私钥、API Key、OAuth token 或可还原的敏感凭证。

### Requirement 4：可配置的上报地址与 App Key

**Objective:** As a 运维/部署方, I want 通过环境变量灵活切换上报地址与 appid, so that 可以按需禁用、对接私有化、或后续切换分站

#### Acceptance Criteria

1. The Tracking Layer shall 提供 `VOLC_TRACKING_ENABLED` 总开关（默认 `true`，置 `false` 时完全不发请求）。
2. The Tracking Layer shall 提供 `VOLC_TRACKING_HOST`（默认 `gator.volces.com`，可覆盖为私有化域名，不含协议头与末尾斜杠）。
3. The Tracking Layer shall 提供 `VOLC_TRACKING_APP_KEY`（默认值为 Lark 文档列出的 gateio 主站 key `dd447b6237008363f06bd97bbd4a27e0`，可在 `.env` 覆盖）。
4. The Tracking Layer shall 提供 `VOLC_TRACKING_APP_ID`（默认 `10000001` / gateio 主站，可覆盖；上报到 `header.custom.app_id` 字段便于排查）。
5. If `VOLC_TRACKING_APP_KEY` 未配置且无默认值（被显式置空）, then the Tracking Layer shall 视同 `ENABLED=false` 静默关闭，不发请求也不抛错。

### Requirement 5：批量与可靠性

**Objective:** As a 后端工程, I want 上报具备基本的批量与缓冲能力, so that 在突发高调用量下不放大 HTTP 流量、并降低被火山限流的概率

#### Acceptance Criteria

1. The Tracking Layer shall 内部维护一个事件队列，调用 `track()` 不立即触发 HTTP 请求。
2. The Tracking Layer shall 在队列长度达到 `VOLC_TRACKING_BATCH_SIZE`（默认 20，硬上限 50，遵守火山 list 接口限制）时立即 flush。
3. The Tracking Layer shall 至少每 `VOLC_TRACKING_FLUSH_MS`（默认 5000）毫秒触发一次定时 flush。
4. When MCP 进程收到 `SIGINT` / `SIGTERM` 或 `beforeExit`, the Tracking Layer shall 尝试同步 flush 一次剩余事件，超过 `VOLC_TRACKING_SHUTDOWN_TIMEOUT_MS`（默认 1000）则放弃。
5. If 一次批量上报失败, then the Tracking Layer shall 丢弃该批次（不做无界重试），并在 stderr 打印一行警告（受 `VOLC_TRACKING_DEBUG` 控制，默认关闭）。

### Requirement 6：可观测与调试

**Objective:** As a 维护者, I want 在调试期能看到埋点是否发出与火山返回, so that 部署前可快速验证

#### Acceptance Criteria

1. When `VOLC_TRACKING_DEBUG=true`, the Tracking Layer shall 在每次 flush 时向 stderr 打印 `[volc-tracking] sent N events, status=xxx, sc=xxx`。
2. The Tracking Layer shall 对火山返回的非 200 状态码或 `sc=0` 情况，在 DEBUG 模式下额外打印响应 body 前 200 字符。
3. The Tracking Layer shall 暴露一个内部 `__flushNow()` 方法（仅供单测/手动验证调用），返回当前队列 flush 的 Promise。

### Requirement 7：性能与零依赖

**Objective:** As a 维护者, I want 接入不引入新 npm 依赖, so that 项目体积、审计面与安全风险保持最小

#### Acceptance Criteria

1. The Tracking Layer shall 仅使用 Node.js 22 内置能力（`fetch`、`crypto.randomUUID`、`fs`、`os`、`process`）。
2. The codebase shall 不新增任何 `dependencies` 或 `devDependencies`。
3. The Tracking Layer 包装层 shall 给单次工具调用引入的同步开销低于 1 ms（不含 HTTP 上报本身）。
