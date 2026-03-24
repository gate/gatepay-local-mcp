# ✅ test/privateKey.ts 已支持 Solana

## 更新内容

已成功为 `test/privateKey.ts` 添加 Solana 网络支持！

## 使用方式

### 1. 配置环境变量

在 `.env` 文件中添加：

```env
# EVM 私钥（必需）
EVM_PRIVATE_KEY=0x你的MetaMask私钥

# Solana 私钥（可选，用于 Solana 网络支付）
SVM_PRIVATE_KEY=5J7你的Phantom私钥
```

### 2. 运行测试

```bash
npm run test:privateKey
```

### 3. 查看输出

**仅配置 EVM 时：**
```
🔐 私钥配置状态:
   ✅ EVM_PRIVATE_KEY: 已配置
   ⚠️  SVM_PRIVATE_KEY: 未配置（仅支持 EVM 网络）
```

**同时配置 EVM 和 Solana 时：**
```
🔐 私钥配置状态:
   ✅ EVM_PRIVATE_KEY: 已配置
   ✅ SVM_PRIVATE_KEY: 已配置（支持 Solana 网络）
```

## 支持的网络

### EVM 网络（必需 EVM_PRIVATE_KEY）
- gatelayer_testnet
- eth (Ethereum)
- base
- Polygon
- gatelayer
- gatechain
- Arbitrum One

### Solana 网络（需要 SVM_PRIVATE_KEY）
- Solana

## 特性

✅ **向后兼容**：如果不配置 `SVM_PRIVATE_KEY`，仍然可以正常使用 EVM 网络  
✅ **自动检测**：根据环境变量自动注册相应的网络  
✅ **友好提示**：启动时显示配置状态  
✅ **保持原有功能**：请求 URL 和请求体完全不变  

## 修改的文件

1. `src/modes/types.ts` - 添加 `solanaSigner` 字段
2. `src/modes/local-private-key.ts` - 支持创建 Solana 签名器
3. `src/modes/registry.ts` - 传递 `solanaSigner` 到 factory
4. `src/modes/build-pay-fetch.ts` - 注册 Solana 网络（已有）
5. `test/privateKey.ts` - 添加配置状态显示

## 快速获取 Solana 私钥

1. 安装 Phantom：https://phantom.app/
2. 创建钱包
3. 导出私钥：设置 ⚙️ → 安全与隐私 → 导出私钥
4. 复制到 `.env` 文件的 `SVM_PRIVATE_KEY`

## 更多文档

- 详细说明：`test/README-privateKey.md`
- Solana 集成：`docs/SOLANA-INTEGRATION.md`
- 快速开始：`docs/SOLANA-QUICKSTART.md`
