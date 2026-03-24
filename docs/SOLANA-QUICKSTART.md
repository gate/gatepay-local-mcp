# Solana 支付快速开始

## 1. 环境准备

在项目根目录创建 `.env` 文件：

```env
# Solana 私钥（base58 格式）
SOLANA_PRIVATE_KEY=your_base58_encoded_private_key_here

# EVM 私钥（hex 格式，可选）
EVM_PRIVATE_KEY=0xYourEvmPrivateKeyHere

# API 端点（可选）
RESOURCE_SERVER_URL=http://localhost:4021
ENDPOINT_PATH=/weather
```

## 2. 获取 Solana 私钥

如果你有 Solana Keypair JSON 文件，可以使用以下代码转换为 base58：

```typescript
import fs from 'fs';
import { base58 } from '@scure/base';

// 读取 keypair.json
const keypair = JSON.parse(fs.readFileSync('./keypair.json', 'utf-8'));
const privateKeyBytes = Uint8Array.from(keypair);

// 转换为 base58
const privateKeyBase58 = base58.encode(privateKeyBytes);
console.log(privateKeyBase58);
```

## 3. 测试签名器

```bash
npm run test:solana-signer
```

预期输出：
```
🔐 创建 Solana 签名器...

✅ Solana 签名器创建成功!
📍 地址: YourSolanaAddress...

📝 签名器信息:
   - 地址: YourSolanaAddress
   - 类型: TransactionSigner
   - 支持网络: solana:mainnet, solana:devnet, solana:testnet
```

## 4. 在代码中使用

### 仅使用 Solana

```typescript
import { X402ClientStandalone } from "./x402/client.js";
import { ExactSvmScheme } from "./x402/exactSvmScheme.js";
import { wrapFetchWithPayment } from "./x402/fetch.js";
import { createLocalSolanaPrivateKeySigner } from "./modes/signers.js";

async function main() {
  // 创建签名器
  const signer = await createLocalSolanaPrivateKeySigner(
    process.env.SOLANA_PRIVATE_KEY!
  );

  // 创建客户端并注册网络
  const client = new X402ClientStandalone();
  client.register("solana:devnet", new ExactSvmScheme(signer));

  // 创建支付 fetch
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // 使用
  const response = await fetchWithPayment("https://api.example.com/data");
  console.log(await response.json());
}
```

### 同时使用 EVM 和 Solana

```typescript
import { createLocalPrivateKeySigner, createLocalSolanaPrivateKeySigner } from "./modes/signers.js";
import { ExactEvmScheme } from "./x402/exactEvmScheme.js";
import { ExactSvmScheme } from "./x402/exactSvmScheme.js";

async function main() {
  const evmSigner = createLocalPrivateKeySigner(process.env.EVM_PRIVATE_KEY as `0x${string}`);
  const solanaSigner = await createLocalSolanaPrivateKeySigner(process.env.SOLANA_PRIVATE_KEY!);

  const client = new X402ClientStandalone();

  // 注册 EVM 网络
  client.register("eth", new ExactEvmScheme(evmSigner));
  client.register("base", new ExactEvmScheme(evmSigner));

  // 注册 Solana 网络
  client.register("solana:devnet", new ExactSvmScheme(solanaSigner));
  client.register("solana:mainnet", new ExactSvmScheme(solanaSigner));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  // 使用...
}
```

### 使用 DefaultPayFetchFactory（推荐）

```typescript
import { DefaultPayFetchFactory } from "./modes/build-pay-fetch.js";
import { createLocalPrivateKeySigner, createLocalSolanaPrivateKeySigner } from "./modes/signers.js";

async function main() {
  const factory = new DefaultPayFetchFactory();

  const fetchWithPayment = factory.build({
    signer: createLocalPrivateKeySigner(process.env.EVM_PRIVATE_KEY as `0x${string}`),
    solanaSigner: await createLocalSolanaPrivateKeySigner(process.env.SOLANA_PRIVATE_KEY!)
  });

  // 已自动注册所有支持的 EVM 和 Solana 网络
  const response = await fetchWithPayment("https://api.example.com/data");
}
```

## 5. 查看完整示例

```bash
cat examples/solana-payment-example.ts
```

## 故障排查

### 错误：私钥格式不正确

确保 Solana 私钥是 base58 格式，而非 hex 格式。

**正确**：`5J7gXb...` (base58)  
**错误**：`0x1234...` (hex, 这是 EVM 格式)

### 错误：feePayer is required

Solana 交易需要 feePayer。确保服务端在 `paymentRequirements.extra.feePayer` 中提供了地址。

### 编译错误

```bash
# 重新安装依赖
npm install

# 清理并重新编译
rm -rf dist node_modules
npm install
npm run build
```

## 更多信息

- 详细集成文档：`docs/SOLANA-INTEGRATION.md`
- 实现总结：`docs/SOLANA-SUMMARY.md`
- 完整示例：`examples/solana-payment-example.ts`
