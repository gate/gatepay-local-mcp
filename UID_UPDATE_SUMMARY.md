# 中心化支付工具 - UID 动态获取更新

## 更新概述

将中心化支付工具的 `uid` 参数从硬编码的固定值改为从 Gate Pay OAuth 认证结果动态获取。

**更新日期**: 2026-03-26

## 主要变更

### 1. parser.ts - 接口和函数签名修改

**文件**: `src/gate-pay/centralized-payment/parser.ts`

- **ExtractedPaymentInfo 接口**
  - `uid` 字段类型从 `number` 改为 `string`
  
- **extractPaymentInfo 函数**
  - `uid` 参数改为可选参数：`uid?: string`
  - 移除默认值 `10002`
  - 返回值中的 `uid` 使用传入的参数或空字符串

```typescript
// 修改前
uid: number = 10002

// 修改后
uid?: string
```

### 2. centralized-payment.ts - 使用动态 UID

**文件**: `src/tools/centralized-payment.ts`

- **导入变更**
  - 移除: `runGatePayDeviceAuthIfNeeded` 和 `getGatePayAccessToken`
  - 新增: `ensureGatePayAccessTokenAndUid`

- **逻辑变更**
  - 使用 `ensureGatePayAccessTokenAndUid()` 一次性获取 `accessToken` 和 `uid`
  - 将获取到的 `uid` 传递给 `extractPaymentInfo()`
  - 简化了认证流程，减少了函数调用

```typescript
// 修改前
await runGatePayDeviceAuthIfNeeded();
const accessToken = getGatePayAccessToken();
const paymentInfo = extractPaymentInfo(paymentData);

// 修改后
const authResult = await ensureGatePayAccessTokenAndUid();
const paymentInfo = extractPaymentInfo(paymentData, authResult.uid);
const paymentResponse = await submitCentralizedPayment(paymentInfo, authResult.accessToken);
```

### 3. 测试文件更新

**文件**: `test/centralized-payment.test.ts`

- 更新测试数据，`uid` 从数字 `10002` 改为字符串 `"10002"`
- 显式传递 `uid` 参数到 `extractPaymentInfo()`

## 技术优势

### ✅ 动态用户识别
- UID 现在从实际的 OAuth 认证结果中获取
- 支持多用户场景，每个用户使用自己的 UID

### ✅ 代码简化
- 减少了函数调用（从 2 个调用简化为 1 个）
- 统一了认证和用户信息获取

### ✅ 类型安全
- UID 使用字符串类型，与 `ensureGatePayAccessTokenAndUid` 返回的类型一致
- 避免了类型转换

### ✅ 向后兼容
- 测试文件仍然可以传递固定的 UID 进行测试
- `extractPaymentInfo` 的 `uid` 参数是可选的

## 数据流变更

### 修改前
```
handleCentralizedPayment
  ↓
runGatePayDeviceAuthIfNeeded() → 获取认证
  ↓
getGatePayAccessToken() → 获取 token
  ↓
extractPaymentInfo(data) → 使用硬编码 uid=10002
  ↓
submitCentralizedPayment(info, token)
```

### 修改后
```
handleCentralizedPayment
  ↓
ensureGatePayAccessTokenAndUid() → 同时获取 token 和 uid
  ↓
extractPaymentInfo(data, uid) → 使用动态获取的 uid
  ↓
submitCentralizedPayment(info, token)
```

## 验证结果

✅ **构建**: TypeScript 编译成功  
✅ **测试**: 所有单元测试通过 (7/7)  
✅ **Linting**: 无 ESLint 错误  

```bash
npm run build              # ✓ 成功
npm run test:centralized-payment  # ✓ 所有测试通过
npx eslint src/...         # ✓ 无错误
```

## API 接口变更

### ExtractedPaymentInfo

```typescript
// 修改前
interface ExtractedPaymentInfo {
  uid: number;  // 固定为 10002
}

// 修改后
interface ExtractedPaymentInfo {
  uid: string;  // 从认证结果动态获取
}
```

### extractPaymentInfo()

```typescript
// 修改前
function extractPaymentInfo(
  data: PaymentRequiredData,
  uid: number = 10002
): ExtractedPaymentInfo

// 修改后
function extractPaymentInfo(
  data: PaymentRequiredData,
  uid?: string  // 可选参数，无默认值
): ExtractedPaymentInfo
```

## 使用示例

```typescript
// 在 handleCentralizedPayment 中
const authResult = await ensureGatePayAccessTokenAndUid();
// authResult = {
//   accessToken: "eyJhbGciOi...",
//   uid: "12345",  // 从 OAuth 认证中获取
//   phase: "already_authenticated"
// }

const paymentInfo = extractPaymentInfo(paymentData, authResult.uid);
// paymentInfo.uid 现在是 "12345" 而不是固定的 10002
```

## 相关文件

- `src/gate-pay/centralized-payment/parser.ts` - 接口和提取逻辑
- `src/tools/centralized-payment.ts` - MCP tool handler
- `src/gate-pay/auth.ts` - 认证函数（ensureGatePayAccessTokenAndUid）
- `test/centralized-payment.test.ts` - 单元测试

## 总结

此次更新将中心化支付的用户识别从硬编码改为动态获取，使系统能够正确识别和处理不同用户的支付请求。代码更简洁、类型更安全，同时保持了向后兼容性。
