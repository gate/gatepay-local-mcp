/**
 * 测试中心化支付模块
 */

import { parsePaymentRequiredHeader, extractPaymentInfo } from "../src/gate-pay/centralized-payment/index.js";

// 测试数据：你提供的示例 PAYMENT-REQUIRED header
const testPayload = {
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "http://localhost:8080/flight/order",
    "description": "Flight order",
    "mimeType": "application/json",
    "orderId": "ORD-45B88F8B"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "amount": "10000000",
      "asset": "BPy1fp1Hb1v6Rr41ayPs8ttRUrjjNqkApudTiinNucg3",
      "payTo": "BupBzPocE7ZeFZ9zzXj3McqmCjWKmzaP4Z2MAQN8o64L",
      "maxTimeoutSeconds": 599,
      "extra": {
        "name": "USDC",
        "prepayId": "82967300620550384",
        "expireTime": 1774491091273,
        "feePayer": "2sNna5GLGutRVAH4ZoUgWxtz31gXKsRTFs6mWmvRmAg4",
        "version": "2",
        "orderId": "ORD-45B88F8B"
      }
    }
  ]
};

console.log("=== 测试中心化支付解析器 ===\n");

// 1. 测试 base64 编码
const base64Encoded = Buffer.from(JSON.stringify(testPayload)).toString("base64");
console.log("1. Base64 编码后的 PAYMENT-REQUIRED header:");
console.log(base64Encoded.substring(0, 80) + "...\n");

// 2. 测试解析
console.log("2. 解析 PAYMENT-REQUIRED header:");
try {
  const parsed = parsePaymentRequiredHeader(base64Encoded);
  console.log("✓ 解析成功");
  console.log("  - x402Version:", parsed.x402Version);
  console.log("  - orderId:", parsed.resource.orderId);
  console.log("  - accepts 数量:", parsed.accepts.length);
  console.log();
} catch (error) {
  console.error("✗ 解析失败:", error);
  process.exit(1);
}

// 3. 测试提取支付信息
console.log("3. 提取支付信息:");
try {
  const parsed = parsePaymentRequiredHeader(base64Encoded);
  const testUid = "10002";
  const paymentInfo = extractPaymentInfo(parsed, testUid);
  
  console.log("✓ 提取成功");
  console.log("  - prepayId:", paymentInfo.prepayId);
  console.log("  - merchantTradeNo:", paymentInfo.merchantTradeNo);
  console.log("  - currency:", paymentInfo.currency);
  console.log("  - totalFee:", paymentInfo.totalFee);
  console.log("  - payCurrency:", paymentInfo.payCurrency);
  console.log("  - payAmount:", paymentInfo.payAmount);
  console.log("  - uid:", paymentInfo.uid);
  console.log();
  
  // 验证期望的输出
  const expected = {
    "prepayId": "82967300620550384",
    "merchantTradeNo": "ORD-45B88F8B",
    "currency": "USDC",
    "totalFee": "10",
    "payCurrency": "USDC",
    "payAmount": "10",
    "uid": "10002"
  };
  
  console.log("4. 验证输出是否符合预期:");
  let allMatch = true;
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = paymentInfo[key as keyof typeof paymentInfo];
    const match = actualValue === expectedValue;
    console.log(`  ${match ? "✓" : "✗"} ${key}: ${actualValue} ${match ? "==" : "!="} ${expectedValue}`);
    if (!match) allMatch = false;
  }
  
  if (allMatch) {
    console.log("\n✓ 所有测试通过！");
  } else {
    console.log("\n✗ 部分测试失败");
    process.exit(1);
  }
} catch (error) {
  console.error("✗ 提取失败:", error);
  process.exit(1);
}
