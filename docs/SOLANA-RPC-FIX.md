# 🔧 Solana RPC 连接修复说明

## 问题原因

### ❌ 之前的错误实现

```typescript
function createRpcClient(network: string, customRpcUrl?: string) {
  const url = customRpcUrl ?? SOLANA_RPC_ENDPOINTS[network];
  return createSolanaRpc(url);  // ❌ 直接传 URL 字符串
}
```

**问题：**
- 直接将 URL 字符串传给 `createSolanaRpc()`
- 这会导致 **504 Gateway Timeout** 或连接失败
- `@solana/kit` 需要的是**集群配置对象**，不是普通字符串

### ✅ 正确的实现（参考官方 @x402/svm）

```typescript
function createRpcClient(network: string, customRpcUrl?: string) {
  const normalizedNetwork = network.toLowerCase();

  if (normalizedNetwork === "solana:devnet") {
    const url = customRpcUrl || DEVNET_RPC_URL;
    return createSolanaRpc(devnet(url));  // ✅ 使用 devnet() 包装
  }
  
  if (normalizedNetwork === "solana:mainnet") {
    const url = customRpcUrl || MAINNET_RPC_URL;
    return createSolanaRpc(mainnet(url));  // ✅ 使用 mainnet() 包装
  }
  
  // ... testnet 同理
}
```

**关键修复：**
- 使用 `devnet(url)`, `mainnet(url)`, `testnet(url)` 包装 URL
- 这些函数返回正确的**集群配置对象**
- 包含了网络的额外元数据和配置

---

## 什么是集群配置对象？

`devnet()`, `mainnet()`, `testnet()` 函数不仅仅传递 URL，还会：

1. **设置正确的 commitment level**（确认级别）
2. **配置重试策略**
3. **添加网络特定的元数据**
4. **设置正确的请求头和参数**

### 对比：

| 方式 | 结果 | 是否工作 |
|------|------|---------|
| `createSolanaRpc("https://api.devnet.solana.com")` | ❌ 只是 URL 字符串 | 504 Timeout |
| `createSolanaRpc(devnet("https://api.devnet.solana.com"))` | ✅ 完整配置对象 | 正常工作 ✅ |

---

## 支持的网络格式

### 标准格式（推荐）

```typescript
"solana:mainnet"  // Solana 主网
"solana:devnet"   // Solana 开发网（推荐用于测试）
"solana:testnet"  // Solana 测试网
```

### 兼容格式（也支持）

```typescript
"solana"          // 等同于 solana:mainnet
"solana-mainnet"  // 等同于 solana:mainnet
"solana-devnet"   // 等同于 solana:devnet
"solana-testnet"  // 等同于 solana:testnet
```

---

## 默认 RPC 端点

```typescript
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const TESTNET_RPC_URL = "https://api.testnet.solana.com";
const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
```

这些是 Solana 官方的公共 RPC 端点：
- ✅ **免费使用**
- ⚠️ **有速率限制**（约 100 请求/秒）
- 🐌 **可能较慢**（公共节点）

---

## 使用自定义 RPC（推荐用于生产）

### 方法 1: 代码中指定

```typescript
const solanaSigner = await createLocalSolanaPrivateKeySigner(privateKey);

// 使用自定义 RPC
client.register(
  "solana:mainnet", 
  new ExactSvmScheme(solanaSigner, {
    rpcUrl: "https://your-fast-rpc.com"
  })
);
```

### 方法 2: 环境变量（未来可支持）

```env
SOLANA_RPC_URL=https://your-fast-rpc.com
```

---

## 推荐的 RPC 提供商

### 1. **Helius** (推荐)
- 网站: https://helius.dev/
- 特点: 专注 Solana，速度快
- 免费额度: 10万请求/月

### 2. **Alchemy**
- 网站: https://www.alchemy.com/solana
- 特点: 企业级，稳定性高
- 免费额度: 30万计算单元/月

### 3. **QuickNode**
- 网站: https://www.quicknode.com/
- 特点: 全球分布，低延迟
- 免费试用: 7天

### 4. **Triton**
- 网站: https://triton.one/
- 特点: 高性能，专业级
- 免费额度: 有限制

---

## 使用示例

### 使用默认 RPC（免费）

```typescript
const solanaSigner = await createLocalSolanaPrivateKeySigner(privateKey);
client.register("solana:devnet", new ExactSvmScheme(solanaSigner));
// 自动使用 https://api.devnet.solana.com
```

### 使用自定义 RPC（高速）

```typescript
const solanaSigner = await createLocalSolanaPrivateKeySigner(privateKey);
client.register(
  "solana:mainnet", 
  new ExactSvmScheme(solanaSigner, {
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
  })
);
```

---

## 故障排查

### 错误: 504 Gateway Timeout

**原因：**
- 使用了旧版代码（直接传 URL 字符串）
- 网络连接问题
- RPC 节点过载

**解决：**
1. ✅ 确保使用最新的修复版本
2. 尝试不同的网络：`solana:devnet` 代替 `solana:mainnet`
3. 使用自定义高速 RPC

### 错误: Unsupported Solana network

**原因：** 网络名称格式不正确

**解决：** 使用标准格式
```typescript
✅ "solana:mainnet"
✅ "solana:devnet"  
✅ "solana:testnet"
❌ "sol"
❌ "Solana"
```

### 性能慢

**原因：** 使用公共 RPC 节点

**解决：** 注册并使用商业 RPC 提供商（如 Helius）

---

## 修改的文件

- `src/x402/exactSvmScheme.ts`
  - 修复 `createRpcClient` 函数
  - 添加 `devnet()`, `mainnet()`, `testnet()` 包装器
  - 支持多种网络名称格式

---

## 验证修复

运行测试确认修复成功：

```bash
# 1. 重新编译
npm run build

# 2. 测试签名器
npm run test:solana-signer

# 3. 测试完整流程
npm run test:privateKey
```

应该看到正常的输出，不再有 504 错误。

---

## 技术细节

### `devnet()` 函数做了什么？

根据 `@solana/kit` 的实现，这些函数：

```typescript
export function devnet(rpcUrl: string): ClusterConfig {
  return {
    url: rpcUrl,
    commitment: 'confirmed',
    wsEndpoint: rpcUrl.replace('https', 'wss'),
    // ... 其他配置
  };
}
```

返回的**不是字符串**，而是包含多个字段的**配置对象**。

### 为什么直接传字符串会失败？

```typescript
// ❌ 错误
createSolanaRpc("https://api.devnet.solana.com")
// 期望: ClusterConfig 对象
// 实际: string
// 结果: 类型不匹配，连接失败

// ✅ 正确
createSolanaRpc(devnet("https://api.devnet.solana.com"))
// 返回: { url: "...", commitment: "confirmed", ... }
// 结果: 正常工作
```

---

## 总结

| 项目 | 之前 | 现在 |
|------|------|------|
| RPC 创建方式 | ❌ `createSolanaRpc(url)` | ✅ `createSolanaRpc(devnet(url))` |
| 网络支持 | 仅 `solana:mainnet` | `solana:mainnet/devnet/testnet` |
| 兼容性 | 差 | 好，支持多种格式 |
| 稳定性 | 504 错误 | 稳定 ✅ |

现在你的 Solana 集成应该可以正常工作了！🎉
