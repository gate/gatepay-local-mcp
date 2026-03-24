# test/privateKey.ts 使用说明

## 功能更新

`test/privateKey.ts` 现在已支持 **EVM 和 Solana 双网络**签名！

## 配置环境变量

在项目根目录的 `.env` 文件中配置：

```env
# EVM 私钥（必需，从 MetaMask 导出）
EVM_PRIVATE_KEY=0x你的EVM私钥...

# Solana 私钥（可选，从 Phantom 导出）
SVM_PRIVATE_KEY=5J7你的Solana私钥...

# 可选：自定义请求地址
RESOURCE_SERVER_URL=https://webws.gate.io:443
ENDPOINT_PATH=/flight/order
```

## 运行测试

```bash
npm run test:privateKey
```

## 支持的网络

### 配置了 EVM_PRIVATE_KEY 时：
- ✅ gatelayer_testnet
- ✅ eth (Ethereum)
- ✅ base
- ✅ Polygon
- ✅ gatelayer
- ✅ gatechain
- ✅ Arbitrum One

### 配置了 SVM_PRIVATE_KEY 时（额外支持）：
- ✅ Solana

## 示例输出

### 仅配置 EVM 私钥：

```bash
🔐 私钥配置状态:
   ✅ EVM_PRIVATE_KEY: 已配置
   ⚠️  SVM_PRIVATE_KEY: 未配置（仅支持 EVM 网络）

请求: https://webws.gate.io:443/flight/order POST
请求体: {"flightId": "FL002","uid": "100","chain":"MATIC","fullCurrType":"USDC_MATIC"}
--- 响应 ---
 { ... }

✓ 完成：已通过 local_private_key 访问 https://webws.gate.io:443/flight/order。
```

### 同时配置 EVM 和 Solana 私钥：

```bash
🔐 私钥配置状态:
   ✅ EVM_PRIVATE_KEY: 已配置
   ✅ SVM_PRIVATE_KEY: 已配置（支持 Solana 网络）

请求: https://webws.gate.io:443/flight/order POST
请求体: {"flightId": "FL002","uid": "100","chain":"MATIC","fullCurrType":"USDC_MATIC"}
--- 响应 ---
 { ... }

✓ 完成：已通过 local_private_key 访问 https://webws.gate.io:443/flight/order。
```

## 工作原理

1. **读取环境变量**
   - 必需：`EVM_PRIVATE_KEY`
   - 可选：`SVM_PRIVATE_KEY`

2. **创建签名器**
   - EVM 签名器：使用 `createLocalPrivateKeySigner`
   - Solana 签名器：使用 `createLocalSolanaPrivateKeySigner`（如果配置了）

3. **注册网络**
   - EVM 网络：注册到 `ExactEvmScheme`
   - Solana 网络：注册到 `ExactSvmScheme`（如果配置了 Solana 签名器）

4. **发起请求**
   - 根据服务器返回的 `402 Payment Required` 响应
   - 自动选择合适的签名器和网络进行支付
   - 完成支付后获取资源

## 注意事项

### 1. 私钥格式

- **EVM_PRIVATE_KEY**: 必须是 hex 格式，可以有或没有 `0x` 前缀
  - ✅ `0x1234567890abcdef...`
  - ✅ `1234567890abcdef...`

- **SVM_PRIVATE_KEY**: 必须是 base58 格式
  - ✅ `5J7gXbK...` (base58)
  - ❌ `0x1234...` (hex，这是 EVM 格式)

### 2. Solana 私钥获取

如果要测试 Solana 网络支付：

1. 安装 Phantom 钱包：https://phantom.app/
2. 创建或导入钱包
3. 导出私钥：设置 → 安全与隐私 → 导出私钥
4. 复制 base58 格式的私钥到 `.env` 文件

### 3. 网络选择

服务器会在 `402 Payment Required` 响应中告知支持的网络列表，客户端会：
- 自动匹配已注册的网络
- 选择第一个匹配的网络进行支付
- 如果请求体指定了 `chain` 字段（如 `"chain":"MATIC"`），会优先使用对应的网络

### 4. 请求参数

默认请求参数（可在 `.env` 中修改）：

```javascript
const REQUEST = {
  url: `${baseURL}${endpointPath}`,
  method: "POST",
  body: '{"flightId": "FL002","uid": "100","chain":"MATIC","fullCurrType":"USDC_MATIC"}',
};
```

- `flightId`: 航班订单 ID
- `uid`: 用户 ID
- `chain`: 指定使用的链（MATIC 即 Polygon）
- `fullCurrType`: 支付币种

## 自定义请求

如果要修改请求，编辑 `test/privateKey.ts` 中的 `REQUEST` 对象：

```typescript
const REQUEST = {
  url: `${baseURL}/your/endpoint`,  // 修改路径
  method: "POST",                    // 或 "GET"
  body: '{"your": "data"}',          // 修改请求体
};
```

## 与其他测试的区别

| 测试文件 | 用途 | 是否支持 Solana |
|----------|------|----------------|
| `test/privateKey.ts` | 本地私钥签名测试 | ✅ 是（本次更新） |
| `test/solana-signer.test.ts` | 仅测试 Solana 签名器创建 | ✅ 是 |
| `examples/solana-payment-example.ts` | 完整示例（双网络） | ✅ 是 |

## 故障排查

### 错误：SVM_PRIVATE_KEY 格式错误

确保使用 base58 格式，而非 hex 格式。可以运行：

```bash
npm run test:solana-signer
```

单独测试 Solana 签名器是否正确。

### 错误：网络不支持

检查服务器返回的 `402 Payment Required` 响应，确认：
1. 服务器支持的网络列表
2. 你的签名器是否注册了对应的网络

### 成功但无支付

如果响应成功但没有触发支付流程，可能原因：
1. 服务器没有返回 `402` 状态码
2. 服务器没有要求支付
3. 资源是免费的

## 完整流程示例

```bash
# 1. 配置环境变量
echo 'EVM_PRIVATE_KEY=0x...' >> .env
echo 'SVM_PRIVATE_KEY=5J7...' >> .env

# 2. 编译项目
npm run build

# 3. 运行测试
npm run test:privateKey

# 4. 查看输出
# ✅ 看到成功消息表示支付流程正常工作
```

## 更多信息

- Solana 集成文档：`docs/SOLANA-INTEGRATION.md`
- 快速开始指南：`docs/SOLANA-QUICKSTART.md`
- 完整示例：`examples/solana-payment-example.ts`
