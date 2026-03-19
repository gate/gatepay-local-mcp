# Requirements Document

## Introduction

本次改造面向 `gatepay-local-mcp` 的核心请求工具 `x402_request`。目标是把当前集中在 `src/index.ts` 中的签名模式分支、配置检查、登录流程和 signer 构建逻辑拆分为可插拔的 `sign_mode` 架构，使本地私钥、quick wallet、后续插件钱包等模式都能以统一方式接入，同时保持 `x402` 支付主流程的一致性、可读性与可扩展性。

## Requirements

### Requirement 1: 统一的 sign_mode 调用模型
**Objective:** As a MCP tool caller, I want `x402_request` 使用统一的 `sign_mode` 参数描述签名模式, so that 不同签名方式可以通过一致的调用约定被选择和扩展

#### Acceptance Criteria
1. When 调用方发起 `x402_request`, the x402 Request Tool shall 接受 `sign_mode` 作为签名模式选择参数。
2. When 调用方未传入 `sign_mode`, the x402 Request Tool shall 按系统定义的优先级自动选择一个当前可用的签名模式。
3. If 调用方传入未知的 `sign_mode`, then the x402 Request Tool shall 返回明确错误并列出支持的签名模式标识。
4. The x402 Request Tool shall 不再接受旧字段别名，并统一要求调用方使用 `sign_mode`。
5. The x402 Request Tool shall 在工具描述和输入 schema 中明确声明 `sign_mode` 的用途、取值和默认选择行为。

### Requirement 2: 签名前的可用性检查与模式选择
**Objective:** As a MCP tool caller, I want 系统在真正请求支付资源前先判断哪些签名模式可用, so that 工具能优先使用已配置好的模式并在缺失配置时给出清晰提示

#### Acceptance Criteria
1. When `x402_request` 开始执行, the Sign Mode Registry shall 在发起业务 HTTP 请求前检查所有已注册签名模式的当前可用性。
2. When 调用方未指定 `sign_mode` and 至少一个签名模式已配置可用, the Sign Mode Registry shall 按预设优先级选择第一个可用模式。
3. If 调用方未指定 `sign_mode` and 没有任何签名模式可用, then the x402 Request Tool shall 返回统一提示，说明需要先配置可用的 token、session 或本地私钥。
4. While 某个签名模式处于“已配置可直接使用”状态, the Sign Mode Registry shall 将其视为可自动选择候选模式。
5. The Sign Mode Registry shall 能够区分“模式存在但未配置”和“模式已配置可直接使用”这两种状态。

### Requirement 3: 显式指定模式时的前置校验
**Objective:** As a MCP tool caller, I want 系统在我显式指定 `sign_mode` 时先校验该模式是否准备就绪, so that 我能快速知道问题出在参数、token 还是登录状态

#### Acceptance Criteria
1. When 调用方显式传入 `sign_mode`, the x402 Request Tool shall 只尝试该模式而不再自动切换到其他模式。
2. If 指定的 `sign_mode` 已注册但未完成必要配置, then the x402 Request Tool shall 返回该模式专属的缺失项提示。
3. If 指定的 `sign_mode` 依赖 token 或 session and 当前 token 或 session 不存在、已失效或不可用, then the x402 Request Tool shall 在签名前终止并返回可操作的提示信息。
4. When 指定的 `sign_mode` 需要交互式登录且产品定义允许补登录, the 对应 Sign Mode 实现 shall 在创建 signer 阶段触发该登录流程。
5. The x402 Request Tool shall 在错误响应中保留被请求的 `sign_mode` 信息，便于调用方定位问题。

### Requirement 4: 可插拔的签名模式架构
**Objective:** As a maintainer, I want 每一种签名模式都以独立领域模块接入统一注册中心, so that 后续新增 quick wallet 变体、插件钱包或其他远程签名模式时不需要修改主流程

#### Acceptance Criteria
1. When 新增一种签名模式, the codebase shall 允许通过新增独立 mode 模块并注册到统一 registry 的方式接入，而不是在入口文件中追加分支。
2. The Sign Mode Registry shall 为每种签名模式提供统一的能力接口，至少覆盖模式标识、优先级、可用性检查和 signer 构建。
3. Where 某个签名模式需要独立的 token 管理、登录逻辑或远程客户端适配, the codebase shall 允许这些逻辑保留在该模式所属目录中。
4. The `src/index.ts` entrypoint shall 只负责参数解析、模式解析、请求执行和响应封装，不直接承载各模式的具体实现细节。
5. The codebase shall 使用清晰的目录边界区分入口编排、x402 协议核心和各 `sign_mode` 的领域实现。

### Requirement 5: 通用的 x402 签名与重试管线
**Objective:** As a maintainer, I want 不同签名模式共享同一条 x402 支付执行主流程, so that 增加新模式时无需重复实现 402 解析、payload 生成和重试逻辑

#### Acceptance Criteria
1. When 目标服务返回 `402 Payment Required`, the x402 Payment Pipeline shall 统一执行 PAYMENT-REQUIRED 解析、payment requirements 归一化、payload 构建、签名和带支付头重试。
2. The x402 Payment Pipeline shall 仅依赖通用 signer 能力接口，而不依赖具体 `sign_mode` 的内部实现。
3. Where 支付 scheme、network 注册和 `payFetch` 构建逻辑在多个模式中共用, the codebase shall 提取这些通用装配方法并避免重复代码。
4. While 各签名模式复用同一支付管线, the system shall 保持现有本地私钥模式与 quick wallet 模式的支付行为一致。
5. The system shall 允许未来在不改动主支付管线的前提下接入新的 EVM signer 来源。

### Requirement 6: 可维护性、可测试性与并发安全
**Objective:** As a maintainer, I want 新架构在可读性提升的同时保持可测试、可缓存和并发安全, so that 重构不会引入重复初始化、难排错或难扩展的问题

#### Acceptance Criteria
1. When 同一 `sign_mode` 在单进程内被重复使用, the system shall 支持复用该模式的已初始化上下文或缓存结果。
2. If 同一 `sign_mode` 被并发请求同时初始化, then the system shall 避免重复创建昂贵会话、重复登录或重复构建相同 signer 上下文。
3. The codebase shall 为“自动选模”“显式模式未配置”“未知模式”“模式登录/配置失效”这些关键场景提供可验证的测试覆盖。
4. The codebase shall 保持 TypeScript 严格类型风格，使模式接口、registry 输出和错误结果具有明确类型定义。
5. The system shall 使用一致的错误建模和提示文案，帮助调用方与维护者快速识别失败阶段。
