# Gatepay Local MCP — 埋点维度与按工具可采集性

本文档与 `src/config/env-config.ts` 中的 `getTrackingConfig()`、`TRACKING_PRODUCT_DEFAULTS`（数据源：`src/config/tracking-product-defaults.json`）对齐，用于实现「每次工具调用后上报」时的字段规划。

符号：**✓** 表示在**不改动工具实现**的前提下，可从本次调用的入参 `arguments` 和/或 `CallToolResult` 返回文本中稳定解析（或可由 MCP 包装层直接得到）；**×** 表示当前形态下拿不到或需额外埋点/宿主注入；**△** 表示仅部分场景有（如某链别名字段）。

---

## 1. 固定维度（写入 `getTrackingConfig()` / JSON，进程内恒定）

| 维度键（建议） | 含义 | 取值来源 |
|----------------|------|----------|
| `app_name` | 应用名 | `tracking-product-defaults.json` → `appName` |
| `app_platform` | 端类型 | 默认 `server` |
| `access_method` | 接入方式 | 默认 `MCP` |
| `client_type` | Client 类型 | 默认 `gatepay-local-mcp` |
| `business_module` | 业务模块 | 默认 `Pay` |
| `product_line` | 产品线 | 默认 `LOCAL MCP` |
| `event_name` | 事件名 | 默认 `mcp_tool_call` |
| `report_host` / `app_id` / `app_key` | 上报域名与鉴权 | 环境变量覆盖，见下 |

环境变量（与 `getTrackingConfig()` 一致）：

| 变量 | 说明 |
|------|------|
| `VOLC_TRACKING_HOST` | 上报域名（无协议、无尾 `/`），默认见 JSON 的 `defaultReportHost` |
| `VOLC_TRACKING_APP_ID` | 数字应用 ID，默认见 JSON 的 `defaultAppId` |
| `VOLC_TRACKING_APP_KEY` | 可选；不设则使用 `tracking-product-defaults.json` 的 `defaultAppKey`（gateio 主站）；分站须覆盖 |
| `VOLC_TRACKING_ENABLED` | 设为 `false` 关闭上报 |

---

## 2. 实时维度（每次调用在包装层或解析层产生）

| 维度键 | 含义 | 获取方式 |
|--------|------|----------|
| `tool_name` | 工具名 | MCP `CallToolRequest.params.name` |
| `tool_name_cn` | 工具中文名 | `src/config/tool-display-names.json` + `getToolDisplayName()` |
| `request` | 请求摘要行 | `formatTrackingRequest(args)` → `METHOD URL`（仅 http(s) 完整 URL，含 query；**不含** header/body）。无 `url` / `resource_url` 时省略该字段 |
| `duration_ms` | 耗时 | 包装层 `Date.now()` 差值 |
| `success` / `error_msg` | 是否成功 | 包装层根据 `isError` 与异常 |
| `local_time_ms` | 事件时间 | 包装层结束时刻毫秒时间戳 |
| `client_version` | Client 版本 | `package.json` 的 `version`（或 MCP Server `version` 字段，需与产品约定一致） |
| `gate_pay_env` | 运行环境 | `getEnvironment()` → `test` / `prd` |
| `sign_mode` | 签名模式 | 部分工具入参 `sign_mode` |
| `wallet_login_provider` | 快捷钱包登录提供方 | 部分工具入参 |
| `user_unique_id` | 用户主键 | **Gate Pay `uid` 优先**（与中心化 OAuth 一致）；否则 **EVM 地址**（`AsyncLocalStorage` + 进程级 sticky：无 signer 的工具继承上次解析到的钱包）；再否则从入参/返回 JSON 白名单字段解析；皆无则 **空串**（不再使用 device_id） |
| `user_id_source`（上报 `params`） | 主键来源标注 | `gate`（Gate uid）/ `wallet`（链上地址）/ `none`（空主键） |
| `agent_name` | 宿主 Agent 名+版本 | stdio 下通常无；**仅**能通过宿主注入环境变量（如 `VOLC_PING_AGENT_NAME`）模拟 |

---

## 2.1 工具名中英文对照（维护 `src/config/tool-display-names.json`）

| `tool_name` | `tool_name_cn` |
|-------------|----------------|
| `x402_place_order` | x402 下单探测（无自动签名） |
| `x402_sign_payment` | x402 签名并支付 |
| `mpp_init_session` | MPP 初始化会话 |
| `mpp_fetch` | MPP 发起 HTTP 请求 |
| `mpp_close_session` | MPP 关闭会话 |
| `mpp_request_close` | MPP 链上请求关闭通道 |
| `mpp_withdraw` | MPP 链上提现 |
| `x402_create_signature` | x402 创建支付签名 |
| `x402_submit_payment` | x402 提交支付 |
| `x402_gate_pay_auth` | Gate Pay 授权登录 |
| `x402_quick_wallet_auth` | 快捷钱包授权登录 |
| `x402_centralized_payment` | Gate Pay 中心化支付 |
| `x402_request` | x402 一站式请求（兼容旧版） |

未出现在表中的工具名：埋点仍传 `tool_name`，`tool_name_cn` 回退为与 `tool_name` 相同字符串。

---

## 2.2 `request` 字段在各工具上的可填性（来自入参 `url` / `resource_url`）

| 工具 | 典型 `request` 示例 | 说明 |
|------|---------------------|------|
| `x402_place_order` | `POST https://…` | 来自 `url` + `method`（缺省 method 时为 `POST`） |
| `x402_sign_payment` | `POST https://…` | 同上 |
| `mpp_fetch` | `POST https://…` | 同上 |
| `x402_submit_payment` | `POST https://…` | 同上 |
| `x402_centralized_payment` | `POST https://…` | 优先 `resource_url`（商户资源），否则 `url` |
| `x402_request` | `POST https://…` | 同 `url` |
| `mpp_init_session` / `mpp_close_session` / `mpp_request_close` / `mpp_withdraw` | （通常无） | 入参无 http URL，**不传** `request` |
| `x402_create_signature` | （通常无） | 仅有 PAYMENT-REQUIRED 片段，**不传** `request` |
| `x402_gate_pay_auth` / `x402_quick_wallet_auth` | （无） | **不传** `request` |

---

## 2.3 各工具入参 / 出参 JSON 示例（对照 `schemas.ts` 与各 `handle*`）

便于你评估：**要不要改工具字段名、是否要在成功体里稳定带出 `user_unique_id` 等**。下列「入参」对应 MCP `CallToolRequest.params.arguments`；「出参」指 `CallToolResult.content[0].text` 的语义（成功时多为 **合法 JSON 字符串**，失败时 `isError: true` 且 `text` 常为**纯文本错误说明**，不一定能 `JSON.parse`）。

### 传输层约定（所有工具相同）

```json
{
  "content": [{ "type": "text", "text": "…字符串…" }],
  "isError": false
}
```

- 成功：`isError` 省略或 `false`；`text` 常为 `JSON.stringify(业务对象, null, 2)`。
- 失败：`isError: true`；`text` 多为一句中文/英文错误（非 JSON）。

---

### `x402_place_order`

**入参（`arguments`）**

```json
{
  "url": "https://merchant.example/api/resource",
  "method": "POST",
  "body": "{\"foo\":1}"
}
```

**出参（成功，`text` 解析后）**

```json
{
  "request": {
    "url": "https://merchant.example/api/resource",
    "method": "POST",
    "body": "{\"foo\":1}"
  },
  "paymentType": "x402",
  "response": {
    "status": 402,
    "statusText": "Payment Required",
    "headers": { "payment-required": "…" },
    "body": "…402 响应体原文…"
  }
}
```

`paymentType`：`"x402"`（存在 `PAYMENT-REQUIRED` 头）、`"mpp"`（`WWW-Authenticate`）、或成功 200 时可能为 `undefined`。

**出参（失败）**：`text` 示例 — `缺少或无效参数 url（需完整 http/https URL）。`

---

### `x402_sign_payment`

**入参**

```json
{
  "url": "https://merchant.example/api/resource",
  "method": "POST",
  "body": "{}",
  "payment_required_header": "BASE64…",
  "response_body": "",
  "sign_mode": "quick_wallet",
  "wallet_login_provider": "gate"
}
```

`payment_required_header` 与 `response_body` 二选一（402 体为 JSON 时可走 `response_body`）。

**出参（成功）**：与商户最终 HTTP 响应一致；实现上经 `formatResponseText`：若响应体 JSON 含顶层 `data`，则 **`text` 内为 `data` 的 pretty JSON**；否则为整段响应的 pretty JSON；非 JSON 则为原文。

```json
{
  "result": "…商户业务字段，形态不固定…"
}
```

**出参（失败）**：如 `解析PAYMENT-REQUIRED失败: …`、`HTTP 403: …`。

---

### `mpp_init_session`

**入参**

```json
{
  "max_deposit": "1",
  "sign_mode": "local_private_key",
  "wallet_login_provider": "gate",
  "decimals": 6
}
```

全部可选；未传 `sign_mode` 时按环境自动级联 `local_private_key` → `quick_wallet` → `plugin_wallet`。

**出参（成功，`phase: initialized` 示例）**

```json
{
  "sessionId": "mpp-0xabc…-1700000000000",
  "accountAddress": "0xabc…",
  "signMode": "local_private_key",
  "loadStrategy": "explicit",
  "loadAttempts": [{ "signMode": "local_private_key", "outcome": "used" }],
  "maxDeposit": "1",
  "phase": "initialized",
  "opened": false,
  "channelId": null,
  "cumulative": "0",
  "message": "会话已初始化。首次 mpp_fetch …"
}
```

`phase` 还可能为 `reused` / `reinit`；`reused` 时多带当前 `opened`、`channelId`、`cumulative`。

---

### `mpp_fetch`

**入参**

```json
{
  "url": "https://merchant.example/mpp/resource",
  "method": "POST",
  "body": "{}",
  "headers": "{\"X-Custom\":\"v\"}"
}
```

`headers` 须为 **JSON 对象字符串**（或宿主已解析为 object 时的等价结构，见实现）。

**出参（成功）**

```json
{
  "sessionId": "mpp-0xabc…-1700000000000",
  "accountAddress": "0xabc…",
  "response": {
    "status": 200,
    "statusText": "OK",
    "body": "…商户响应原文…"
  },
  "session": {
    "opened": true,
    "channelId": "0x…64hex…",
    "cumulative": "1000000"
  }
}
```

---

### `mpp_close_session`

**入参**

```json
{ "account_address": "0xabc…" }
```

可传空对象 `{}`（关闭任意一个缓存会话）。

**出参（成功）**

```json
{
  "sessionId": "mpp-0xabc…-1700000000000",
  "accountAddress": "0xabc…",
  "closed": true,
  "receipt": {
    "channelId": "0x…",
    "acceptedCumulative": "…",
    "spent": "…",
    "txHash": "0x…",
    "timestamp": "…"
  },
  "error": null,
  "message": "会话已关闭，结算完成。…"
}
```

`receipt` / `error` 可能因未正式开通道或链上失败而为 `null` / 非空字符串。

---

### `mpp_request_close`

**入参**

```json
{
  "account_address": "0xabc…",
  "rpc_url": "https://mainnet.base.org"
}
```

均可选。

**出参（成功）**

```json
{
  "sessionId": "mpp-0xabc…-1700000000000",
  "accountAddress": "0xabc…",
  "txHash": "0x…",
  "chainId": 8453,
  "escrowContract": "0x…",
  "channelId": "0x…",
  "message": "已在托管合约上发送 requestClose 交易。…"
}
```

---

### `mpp_withdraw`

**入参**

```json
{
  "account_address": "0xabc…",
  "channel_id": "0x…64 hex…",
  "rpc_url": "https://mainnet.base.org"
}
```

均可选；无本地 `channelId` 时需显传 `channel_id`。

**出参（成功）**

```json
{
  "sessionId": "mpp-0xabc…-1700000000000",
  "accountAddress": "0xabc…",
  "txHash": "0x…",
  "chainId": 8453,
  "escrowContract": "0x…",
  "channelId": "0x…",
  "message": "已在托管合约上发送 withdraw 交易。…"
}
```

---

### `x402_create_signature`

**入参**

```json
{
  "payment_required_header": "BASE64…",
  "response_body": "",
  "sign_mode": "plugin_wallet",
  "wallet_login_provider": "gate"
}
```

**出参（成功）**

```json
{
  "paymentPayload": {
    "x402Version": 1,
    "resource": { "url": "…", "description": "…", "mimeType": "application/json" },
    "accepted": {
      "scheme": "exact/evm",
      "network": "base",
      "asset": "0x…",
      "amount": "1000000",
      "maxTimeoutSeconds": 60,
      "extra": {}
    },
    "payload": {},
    "extensions": { "signMode": "plugin_wallet" }
  },
  "encodedSignature": "BASE64…"
}
```

`payload` / `scheme` 随 x402 版本与链别变化；EVM `exact` 时常含 `authorization` + `signature` 等嵌套字段（见 `src/x402/types.ts`）。

---

### `x402_submit_payment`

**入参（钱包签名重试）**

```json
{
  "url": "https://merchant.example/api/resource",
  "method": "POST",
  "body": "{}",
  "payment_signature": "BASE64…"
}
```

**入参（中心化 + Bearer）**

```json
{
  "url": "https://merchant.example/api/resource",
  "method": "POST",
  "body": "{}",
  "payment_signature": "BASE64…",
  "sign_mode": "centralized_payment"
}
```

**出参（成功）**：同 `x402_sign_payment`，走 `handleResponseWithBalanceCheck` + `formatResponseText` 规则。

---

### `x402_gate_pay_auth`

**入参**

```json
{}
```

**出参（成功）**

```json
{
  "status": "authorized",
  "summary": "Gate Pay 设备流登录成功，已保存 access_token。",
  "gate_pay_access_token_masked": "abcd1234…wxyz",
  "gate_pay_uid_masked": "12…89"
}
```

`status` 在已有 token 时可能为 `ready`；`summary` 随 `phase` 变化。

---

### `x402_quick_wallet_auth`

**入参**

```json
{ "wallet_login_provider": "gate" }
```

**出参（成功，已登录、未刚完成浏览器登录）** — `text` 为 JSON：

```json
{
  "status": "ready",
  "summary": "quick_wallet 进程内已有有效 MCP 登录态。",
  "wallet_addresses": {}
}
```

`wallet_addresses` 为快捷钱包 MCP `walletGetAddresses` 经解析后的对象，**字段集合不固定**（随托管钱包实现变化）。

**出参（成功，刚完成设备流登录）** — `text` 为 **非 JSON**：首行说明 + `钱包地址信息：` 后接地址 JSON 字符串（实现见 `quick-wallet-auth.ts`）。

---

### `x402_centralized_payment`

**入参**

```json
{
  "payment_required_header": "BASE64…",
  "resource_url": "https://merchant.example/api/paid",
  "method": "POST",
  "body": "{}"
}
```

**出参（成功）**：`text` 为 `JSON.stringify(商户 resource_url 响应体字符串, null, 2)`，即 **先得到带引号/转义的 JSON 字符串字面量**；若商户返回 JSON，常见用法：`JSON.parse(text)` 得原始 body 字符串，再 `JSON.parse` 第二次得对象。

**出参（失败）**：纯文本，如 `中心化支付失败: …`。

---

### `x402_request`（未在 `ListTools` 暴露，兼容旧客户端）

**入参**

```json
{
  "url": "https://merchant.example/api/resource",
  "method": "POST",
  "body": "{}",
  "sign_mode": "quick_wallet",
  "wallet_login_provider": "gate"
}
```

**出参（成功 / 失败）**：与 `x402_sign_payment` 同一套 `payFetch` + `handleResponseWithBalanceCheck` 语义。

---

## 3. 各工具 × 指标（仅从当前入参 + 公开返回解析）

说明：**✓** = 可直接解析；**×** = 当前无；**△** = 视返回/链类型需定制解析（如从 `paymentPayload` 内嵌字段取 `from`）。

| 工具 | user_unique_id | sign_mode | wallet_login_provider | agent_name | tool_name / duration / success / 固定维度* |
|------|:---:|:---:|:---:|:---:|:---:|
| `x402_place_order` | × | × | × | × | ✓ |
| `x402_sign_payment` | × | ✓ | ✓ | × | ✓ |
| `mpp_init_session` | ✓ | ✓ | ✓ | × | ✓ |
| `mpp_fetch` | ✓ | × | × | × | ✓ |
| `mpp_close_session` | ✓ | × | × | × | ✓ |
| `mpp_request_close` | ✓ | × | × | × | ✓ |
| `mpp_withdraw` | ✓ | × | × | × | ✓ |
| `x402_create_signature` | △ | ✓ | ✓ | × | ✓ |
| `x402_submit_payment` | × | △ | × | × | ✓ |
| `x402_gate_pay_auth` | × | × | × | × | ✓ |
| `x402_quick_wallet_auth` | △ | × | ✓ | × | ✓ |
| `x402_centralized_payment` | × | × | × | × | ✓ |
| `x402_request`（未在 ListTools 暴露） | × | ✓ | ✓ | × | ✓ |

\* **固定维度** 指：`access_method`、`client_type`、`business_module`、`product_line`、`app_name`、`app_platform`、`client_version`、`gate_pay_env` 等由 `getTrackingConfig()` + 包装层统一附带，**上表最后一列对这些一律视为 ✓**，不再逐格重复。

### 上表字段说明（为何是 ✓ / × / △）

- **user_unique_id**
  - **实现**：`src/tracking/tracking-invocation-context.ts`（`AsyncLocalStorage` + sticky）在各 signer / Gate Pay / MPP / quick_wallet_auth 路径写入 **仅** `uid` 与 **合法 EVM 地址**；`resolveUserId`（`identity.ts`）优先级：**Gate uid > EVM（含继承）> args/result 解析 > 空串**。
  - **MPP 系列**：成功 JSON 中含 `accountAddress`，且会话路径会同步写入 tracking context。
  - **x402_create_signature**：成功体含 `paymentPayload`，EVM 场景常可解析出 `from`（△）。
  - **x402_quick_wallet_auth**：地址 payload 写入 context；返回里可能仍仅 △。
  - **x402_sign_payment**：成功体多为商户资源 HTTP 原文，一般不含付款人地址（×）；现可由 **同进程内最近一次 signer 写入的 EVM** 继承（非从私钥推导，仅为已解析的 `address` 字符串）。
  - **x402_place_order / submit（无 Gate）**：依赖 sticky EVM 或 args/result；无则空串。
  - **Gate Pay 中心化**：`uid` 写入 `user_unique_id`（`user_id_source: gate`）；`clearGatePayAccessToken` 会清空 sticky uid。

- **sign_mode**
  - 仅在有 `sign_mode` 入参或内部等价选择的工具为 ✓；纯 HTTP 探测、纯链上关闭类为 ×。
  - **x402_submit_payment**：仅当走中心化分支时语义上固定为 `centralized_payment`（△）。

- **wallet_login_provider**
  - 与 schema 中声明该字段的工具为 ✓。

- **agent_name**
  - stdio MCP 进程**不掌握** Cursor / Claude 等宿主信息，全部为 ×；若宿主设置环境变量，包装层可读 env 变为 ✓（表内仍标 × 表示「默认无」）。

---

## 4. 与联调脚本 `scripts/volc-tracking-ping.mjs` 的关系

- Ping 脚本中的 **产品常量** 与 **`VOLC_TRACKING_*` 默认 host / appId** 应与 `tracking-product-defaults.json` 保持一致（脚本通过读取该 JSON 避免与 TS 分叉）。
- 测试用 **`VOLC_PING_*`** 仅用于脚本占位，正式上报应走 `getTrackingConfig()` + 包装层解析逻辑。
