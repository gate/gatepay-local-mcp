# X402 工具拆分说明

本次更新将原有的单一 `x402_request` 工具拆分为两个独立工具，以提供更灵活的支付流程控制。

## 变更概述

### 已移除（注释）的工具
- ❌ `x402_request` - 原有的一体化工具已注释，不再对外暴露（代码保留用于向后兼容）

### 新增工具

#### 1. `x402_place_order` - 下单工具

**用途**: 发起HTTP请求并返回完整的响应信息，包括响应头和响应体。

**输入参数**:
```typescript
{
  url: string;          // 必需：完整的HTTP(S) URL
  method?: string;      // 可选：HTTP方法 (GET, POST, PUT, PATCH)，默认POST
  body?: string;        // 可选：JSON字符串请求体（POST/PUT/PATCH）
}
```

**输出格式**:
```json
{
  "request": {
    "url": "https://example.com/api/order",
    "method": "POST",
    "body": "{\"key\":\"value\"}"
  },
  "response": {
    "status": 402,
    "statusText": "Payment Required",
    "headers": {
      "payment-required": "base64EncodedPaymentInfo...",
      "content-type": "application/json",
      ...
    },
    "body": "响应体内容"
  }
}
```

**使用场景**:
- X402支付流程的第一步
- 获取402响应和PAYMENT-REQUIRED头
- 保存响应信息供后续签名支付使用

#### 2. `x402_sign_payment` - 签名支付工具

**用途**: 解析PAYMENT-REQUIRED响应头，使用指定的签名方式进行签名，并携带签名重新请求完成支付。

**输入参数**:
```typescript
{
  url: string;                      // 必需：原始请求URL（同place_order）
  method?: string;                  // 可选：原始HTTP方法（同place_order）
  body?: string;                    // 可选：原始请求体（同place_order）
  payment_required_header?: string; // PAYMENT-REQUIRED响应头内容（base64）
  response_body?: string;           // 可选：响应体（当响应头中没有PAYMENT-REQUIRED时）
  sign_mode?: string;               // 可选：签名模式（见下方）
  wallet_login_provider?: string;   // 可选：quick_wallet登录提供商（google|gate）
}
```

**签名模式** (`sign_mode`):
- `local_private_key` - 本地私钥签名（需要环境变量 `EVM_PRIVATE_KEY`）
- `quick_wallet` - 托管钱包签名（需要环境变量 `QUICK_WALLET_API_KEY`）
- `plugin_wallet` - 插件钱包签名（需要环境变量 `PLUGIN_WALLET_TOKEN`）
- 不指定 - 自动选择最高优先级的可用模式

**输出格式**:
支付成功时返回商户的业务响应（如订单信息）。

## 使用示例

### 完整的两步支付流程

```typescript
// 步骤1: 下单
const placeOrderResult = await mcp.callTool({
  name: "x402_place_order",
  arguments: {
    url: "https://example.com/api/order",
    method: "POST",
    body: JSON.stringify({ productId: "123", quantity: 1 })
  }
});

// 解析下单结果
const orderData = JSON.parse(placeOrderResult.content[0].text);
const paymentRequiredHeader = orderData.response.headers["payment-required"];

// 步骤2: 签名支付
const paymentResult = await mcp.callTool({
  name: "x402_sign_payment",
  arguments: {
    url: orderData.request.url,
    method: orderData.request.method,
    body: orderData.request.body,
    payment_required_header: paymentRequiredHeader,
    sign_mode: "local_private_key"  // 或不指定，自动选择
  }
});

// 获取支付结果
const finalResult = JSON.parse(paymentResult.content[0].text);
console.log("订单已支付:", finalResult);
```

## 技术优势

1. **职责分离**: 下单和支付逻辑解耦，更清晰
2. **灵活控制**: 可在下单和支付之间插入业务逻辑
3. **错误处理**: 可针对每一步进行独立的错误处理和重试
4. **可观察性**: 可查看和记录完整的请求/响应信息
5. **向后兼容**: 原有代码保留，可根据需要恢复

## 环境变量配置

与之前相同，根据使用的签名模式配置相应的环境变量：

```bash
# 本地私钥模式
EVM_PRIVATE_KEY=0x...

# 托管钱包模式
QUICK_WALLET_API_KEY=your_api_key
QUICK_WALLET_SERVER_URL=https://api.gatemcp.ai/mcp/dex  # 可选

# 插件钱包模式
PLUGIN_WALLET_TOKEN=your_token
PLUGIN_WALLET_SERVER_URL=https://walletmcp.gate.com/mcp  # 可选
```

## 测试

运行测试验证新工具:

```bash
# 编译
npm run build

# 运行拆分工具测试（需要配置 EVM_PRIVATE_KEY 或 QUICK_WALLET_API_KEY）
npm run test:split-tools
```

## 迁移指南

如果之前使用了 `x402_request` 工具，现在需要改为两步调用：

**之前**:
```typescript
const result = await mcp.callTool({
  name: "x402_request",
  arguments: { url, method, body, sign_mode }
});
```

**现在**:
```typescript
// 步骤1: 下单
const orderResult = await mcp.callTool({
  name: "x402_place_order",
  arguments: { url, method, body }
});

const orderData = JSON.parse(orderResult.content[0].text);

// 步骤2: 支付
const paymentResult = await mcp.callTool({
  name: "x402_sign_payment",
  arguments: {
    url: orderData.request.url,
    method: orderData.request.method,
    body: orderData.request.body,
    payment_required_header: orderData.response.headers["payment-required"],
    sign_mode
  }
});
```

## 常见问题

**Q: 为什么要拆分成两个工具？**  
A: 拆分后可以更灵活地控制支付流程，例如在下单后检查价格、添加确认步骤、实现重试逻辑等。

**Q: 原有的 x402_request 工具还能用吗？**  
A: 代码保留但不再对外暴露。如需使用请联系开发团队。

**Q: 如果服务端没有返回402怎么办？**  
A: `x402_place_order` 会返回实际的响应状态码和内容，你可以根据状态码判断是否需要调用 `x402_sign_payment`。

**Q: 可以只用 place_order 不用 sign_payment 吗？**  
A: 可以。`place_order` 是普通的HTTP请求工具，可以单独使用查看响应信息。
