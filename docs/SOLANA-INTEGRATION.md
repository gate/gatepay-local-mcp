# Solana 网络支付集成说明

本项目现已支持 Solana 网络的 x402 支付功能。

## 安装依赖

所需的 Solana 依赖已包含在 `package.json` 中：

```json
{
  "@solana/kit": "^latest",
  "@scure/base": "^latest",
  "@solana-program/compute-budget": "^latest",
  "@solana-program/token": "^latest",
  "@solana-program/token-2022": "^latest"
}
```

## 使用方式

### 1. 创建 Solana 签名器

使用本地私钥创建 Solana 签名器：

```typescript
import { createLocalSolanaPrivateKeySigner } from "./modes/signers.js";

// Solana 私钥为 base58 编码的字符串
const solanaPrivateKey = "your_base58_encoded_private_key";
const solanaSigner = await createLocalSolanaPrivateKeySigner(solanaPrivateKey);
```

### 2. 注册 Solana 网络

在 `build-pay-fetch.ts` 中，已经预配置了 Solana 网络支持：

```typescript
import { ExactSvmScheme } from "../x402/exactSvmScheme.js";

const client = new X402ClientStandalone();

// 支持的 Solana 网络
const solanaNetworks = ["solana:mainnet", "solana:devnet", "solana:testnet"];

for (const network of solanaNetworks) {
  client.register(network, new ExactSvmScheme(solanaSigner));
}
```

### 3. 完整示例

```typescript
import { config } from "dotenv";
import { X402ClientStandalone } from "../x402/client.js";
import { wrapFetchWithPayment } from "../x402/fetch.js";
import { ExactEvmScheme } from "../x402/exactEvmScheme.js";
import { ExactSvmScheme } from "../x402/exactSvmScheme.js";
import { 
  createLocalPrivateKeySigner, 
  createLocalSolanaPrivateKeySigner 
} from "./signers.js";

config();

async function main() {
  // 1. 创建签名器
  const evmSigner = createLocalPrivateKeySigner(process.env.EVM_PRIVATE_KEY as `0x${string}`);
  const solanaSigner = await createLocalSolanaPrivateKeySigner(process.env.SOLANA_PRIVATE_KEY as string);

  // 2. 创建客户端
  const client = new X402ClientStandalone();

  // 3. 注册 EVM 网络
  const evmNetworks = ["gatelayer_testnet", "eth", "base", "Polygon"];
  for (const network of evmNetworks) {
    client.register(network, new ExactEvmScheme(evmSigner));
  }

  // 4. 注册 Solana 网络
  const solanaNetworks = ["solana:mainnet", "solana:devnet", "solana:testnet"];
  for (const network of solanaNetworks) {
    client.register(network, new ExactSvmScheme(solanaSigner));
  }

  // 5. 创建支付 fetch
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // 6. 发起请求
  const response = await fetchWithPayment("http://your-api-endpoint.com", {
    method: "GET",
  });

  console.log(await response.json());
}

main();
```

## 环境变量配置

在 `.env` 文件中配置：

```env
# EVM 私钥 (以 0x 开头的 hex 字符串)
EVM_PRIVATE_KEY=0x1234567890abcdef...

# Solana 私钥 (base58 编码的字符串)
SOLANA_PRIVATE_KEY=5J7... # 你的 Solana 私钥

# 资源服务器地址
RESOURCE_SERVER_URL=http://localhost:4021
ENDPOINT_PATH=/weather
```

## 技术细节

### Solana 签名器接口

`ClientSvmSigner` 类型直接使用 `@solana/kit` 的 `TransactionSigner` 接口：

```typescript
export type ClientSvmSigner = TransactionSigner;
```

这确保了与 Solana 生态工具的完全兼容性。

### ExactSvmScheme 实现

`ExactSvmScheme` 类实现了 x402 的 Solana 支付方案：

- 支持 SPL Token 和 Token-2022 标准
- 自动查找关联代币账户 (ATA)
- 包含 Memo 指令用于交易唯一性
- 支持自定义 RPC 端点
- 计算单元限制和优先费用配置

### 支持的网络

默认支持以下 Solana 网络：

- `solana:mainnet` - Solana 主网
- `solana:devnet` - Solana 开发网
- `solana:testnet` - Solana 测试网

## 注意事项

1. **私钥格式**：
   - EVM: `0x` 开头的 hex 字符串
   - Solana: base58 编码的字符串

2. **Fee Payer**：Solana 交易需要在 `paymentRequirements.extra.feePayer` 中提供费用支付者地址。

3. **RPC 端点**：可以通过配置自定义 RPC 端点以获得更好的性能。

## 示例文件

查看 `examples/solana-payment-example.ts` 获取完整的使用示例。

## 相关文件

- `src/x402/exactSvmScheme.ts` - Solana 支付方案实现
- `src/x402/types.ts` - 类型定义
- `src/modes/signers.ts` - 签名器创建函数
- `src/modes/build-pay-fetch.ts` - 支付 fetch 构建工厂
- `examples/solana-payment-example.ts` - 完整示例
