# 技术栈

## 架构

项目采用“单入口 MCP 服务 + 内置 x402 支付核心 + 远程钱包适配”的轻量分层结构。`src/index.ts` 负责加载环境、注册 MCP Tool、校验输入并装配支付执行链路；真正的 `402 -> 解析 -> 签名 -> 重试` 逻辑沉淀在 `x402-standalone` 目录下；远程托管钱包能力通过独立的钱包适配层接入。

## 核心技术

- **语言**：TypeScript
- **运行时**：Node.js ESM 风格运行，`tsconfig` 采用 `module: Node16`
- **协议框架**：`@modelcontextprotocol/sdk`
- **链上与签名**：`viem`、`@noble/secp256k1`

## 关键库

- `@modelcontextprotocol/sdk`：实现本地 `stdio` MCP Server，并在托管钱包模式下连接远程 MCP 服务。
- `viem`：负责 EVM 账户与签名相关能力。
- `@noble/secp256k1`：补充底层签名能力。
- `dotenv`：从仓库根目录加载运行时环境变量。

## 开发标准

### 类型安全

项目启用 TypeScript `strict` 模式，并输出声明文件。新代码默认以明确类型、显式输入校验和受控的 `unknown`/`Record<string, unknown>` 边界来处理来自 MCP 请求和远程响应的不确定数据。

### 代码质量

仓库使用 ESLint Flat Config 校验 TypeScript 代码，Prettier 统一格式。当前格式约定包括分号、双引号和 ES 模块导入风格；本地模块导入通常显式带 `.js` 后缀，以匹配 Node16 模块解析行为。

### 测试

测试以脚本化验证为主，放在 `test/` 目录中，覆盖本地私钥、托管钱包、设备码登录和 MCP Tool 调用等真实链路场景。该仓库当前更偏向集成验证，而不是完整的单元测试体系。

## 开发环境

### 必备工具

- Node.js 20+（需支持当前 TypeScript/ESM 运行方式）
- npm 或 pnpm（以 `package.json` scripts 为准）
- 可选的 EVM 私钥或远程 MCP 钱包访问凭证，用于实际支付链路验证

### 常用命令

```bash
# 开发运行
npm run dev

# 构建
npm run build

# 代码检查
npm run lint:check
npm run format:check

# 真实链路脚本测试
npm run test:mcp-tool
```

## 关键技术决策

- 将 `x402` 逻辑内置在仓库中，而不是依赖外部 `@x402/*` 包，优先保证发布与分发的独立性。
- 对外只暴露一个 MCP Tool，减少上层 Agent 的决策复杂度，把协议复杂性封装在服务内部。
- 同时支持“本地私钥签名”和“托管钱包签名”两条路径，以适配不同的安全与部署边界。
- 在入口层缓存支付包装后的 `fetch` 和远程钱包初始化过程，避免同一进程内重复建立昂贵上下文。

---
_记录影响开发方式的技术决策与约束，不罗列全部依赖或环境变量细节。_
