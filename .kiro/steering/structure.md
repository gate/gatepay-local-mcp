# 项目结构

## 组织理念

项目采用“小入口 + 能力分层”的组织方式。入口层负责协议暴露、运行时装配和错误返回；支付协议与签名逻辑下沉到独立模块；钱包登录、令牌持久化和远程 MCP 交互继续拆分到适配目录中。新增代码应优先放入对应能力层，而不是继续堆积到入口文件。

## 目录模式

### MCP 入口层
**Location**: `src/index.ts`  
**Purpose**: 定义工具元数据、解析请求参数、选择鉴权模式、连接支付执行链路并返回 MCP 响应。  
**Example**: `x402_request` 的 schema、输入校验、`quick_wallet` 与本地私钥模式切换。

### x402 支付核心
**Location**: `src/x402-standalone/`  
**Purpose**: 存放与 `x402` 协议直接相关的核心实现，如支付需求解析、支付载荷生成、请求重试、签名器和类型定义。  
**Example**: `client.ts` 负责按 network/scheme 选择实现，`fetch.ts` 负责包装 `fetch` 完成 402 重试。

### 钱包与远程 MCP 适配
**Location**: `src/x402-standalone/wallet/`  
**Purpose**: 存放托管钱包登录、认证状态持久化、远程 MCP Client 封装等与钱包接入有关的边界代码。  
**Example**: 设备码登录、`mcp_token` 持久化、远程 `callTool` 封装。

### 场景化验证脚本
**Location**: `test/`  
**Purpose**: 使用脚本验证完整链路、外部依赖和真实运行时行为。  
**Example**: 启动 MCP 子进程后调用 `x402_request`，或验证钱包登录和签名流程。

## 命名约定

- **文件**：以 `kebab-case` 为主；保留约定型入口文件名如 `index.ts`。
- **类**：使用 `PascalCase`，通常用于协议客户端、签名器或适配器。
- **函数与变量**：使用 `camelCase`，名称直接表达行为，例如 `getOrCreateLocalPayFetch`、`loadAuth`。

## 导入组织

```typescript
import { config } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { X402ClientStandalone } from "./x402-standalone/client.js";
import { wrapFetchWithPayment } from "./x402-standalone/fetch.js";
```

**Path Aliases**:
- 当前不使用路径别名，仓库内模块统一采用相对路径导入。

## 代码组织原则

- 入口层只做编排、输入校验和响应封装，不承载可复用的协议细节。
- `x402-standalone` 下的模块应保持可组合，尽量围绕单一职责组织，如类型、HTTP 解析、签名、协议选择。
- 钱包适配层可以依赖远程 MCP 和本地文件系统，但支付核心尽量不直接耦合具体登录流程。
- 与外部系统交互的结果先在边界层做解析和归一化，再交给内部逻辑消费。
- 新增工具或支付模式时，优先复用现有分层：入口扩展参数，核心层扩展协议能力，钱包层扩展认证或签名适配。

---
_记录目录模式与依赖边界，不维护完整文件树。_
