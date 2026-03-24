# 运行 Solana 支付示例

## 前置准备

### 1. 确保已安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# EVM 私钥（从 MetaMask 导出，hex 格式）
EVM_PRIVATE_KEY=0x你的EVM私钥...

# Solana 私钥（从 Phantom 导出，base58 格式）
SVM_PRIVATE_KEY=5J7你的Solana私钥...

# 可选：自定义资源服务器地址
RESOURCE_SERVER_URL=https://webws.gate.io:443
ENDPOINT_PATH=/flight/order
```

**注意事项：**
- `EVM_PRIVATE_KEY`: 从 MetaMask 导出的私钥，以 `0x` 开头
- `SVM_PRIVATE_KEY`: 从 Phantom 等 Solana 钱包导出的私钥，base58 格式（如 `5J7gXb...`）
- 如果不设置服务器地址，会使用默认值

## 运行方式

### 方法 1：使用 npm 脚本（推荐）

```bash
npm run example:solana
```

### 方法 2：直接使用 tsx

```bash
npx tsx examples/solana-payment-example.ts
```

### 方法 3：编译后运行

```bash
# 先编译
npm run build

# 运行编译后的代码
node dist/examples/solana-payment-example.js
```

## 预期输出

成功运行后，你应该看到类似以下输出：

```
Making request to: https://webws.gate.io:443/flight/order

Response body: { ... }
```

## 示例说明

这个示例展示了如何：

1. **创建 EVM 和 Solana 签名器**
   ```typescript
   const evmSigner = createLocalPrivateKeySigner(evmPrivateKey);
   const solanaSigner = await createLocalSolanaPrivateKeySigner(solanaPrivateKey);
   ```

2. **注册多个网络**
   - EVM 网络: Ethereum, Base, Polygon, Arbitrum One, gatelayer 等
   - Solana 网络: mainnet, devnet, testnet

3. **使用 x402 协议发起支付请求**
   ```typescript
   const fetchWithPayment = wrapFetchWithPayment(fetch, client);
   const response = await fetchWithPayment(url, { method: "GET" });
   ```

## 快速测试（不需要真实支付）

如果你只是想测试签名器创建，可以运行：

```bash
# 测试 Solana 签名器
npm run test:solana-signer
```

这个命令会验证你的 Solana 私钥是否正确配置。

## 常见问题

### 错误：`EVM_PRIVATE_KEY is required`

**原因：** `.env` 文件中没有配置 EVM 私钥

**解决：** 从 MetaMask 导出私钥并添加到 `.env` 文件

### 错误：`SVM_PRIVATE_KEY is required` 或 `private key format invalid`

**原因：** Solana 私钥未配置或格式不正确

**解决：** 
1. 安装 Phantom 钱包（https://phantom.app/）
2. 导出私钥（设置 → 安全与隐私 → 导出私钥）
3. 复制 base58 格式的私钥到 `.env` 文件

### 错误：网络请求失败

**可能原因：**
1. 资源服务器地址不正确
2. 网络连接问题
3. API endpoint 不支持 x402 协议

**解决：** 检查 `RESOURCE_SERVER_URL` 和 `ENDPOINT_PATH` 配置

## 修改示例

你可以修改示例来测试不同的场景：

### 1. 修改请求的 URL

在 `.env` 文件中：

```env
RESOURCE_SERVER_URL=https://your-api.example.com
ENDPOINT_PATH=/your/endpoint
```

### 2. 只使用 Solana 网络

修改 `examples/solana-payment-example.ts`，注释掉 EVM 相关代码：

```typescript
// 只创建 Solana 签名器
const solanaSigner = await createLocalSolanaPrivateKeySigner(solanaPrivateKey);

const client = new X402ClientStandalone();

// 只注册 Solana 网络
client.register("solana:devnet", new ExactSvmScheme(solanaSigner));
```

### 3. 添加更多网络

```typescript
// 添加更多 Solana 网络
client.register("solana:mainnet", new ExactSvmScheme(solanaSigner));
client.register("solana:testnet", new ExactSvmScheme(solanaSigner));

// 添加更多 EVM 网络
client.register("Optimism", new ExactEvmScheme(evmSigner));
client.register("Avalanche", new ExactEvmScheme(evmSigner));
```

## 下一步

- 查看详细文档：`docs/SOLANA-INTEGRATION.md`
- 查看快速开始：`docs/SOLANA-QUICKSTART.md`
- 查看实现总结：`docs/SOLANA-SUMMARY.md`

## 需要帮助？

如果遇到问题，请检查：
1. ✅ 依赖是否安装完整（`npm install`）
2. ✅ `.env` 文件是否正确配置
3. ✅ 私钥格式是否正确（EVM: `0x...`, Solana: base58）
4. ✅ TypeScript 编译是否通过（`npm run build`）
