/**
 * 测试中心化支付模块
 */

import { parsePaymentRequiredHeader, extractPaymentInfo } from "../src/gate-pay/centralized-payment/index.js";

// 测试数据：你提供的示例 PAYMENT-REQUIRED header
const base64Encoded = "eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cDovL2xvY2FsaG9zdDo4MDgwL2ZsaWdodC9vcmRlciIsImRlc2NyaXB0aW9uIjoiRmxpZ2h0IG9yZGVyIiwibWltZVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIiwib3JkZXJJZCI6Ik9SRC0wQUI2NjNGMiJ9LCJhY2NlcHRzIjpbeyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJzb2xhbmEtZGV2bmV0IiwiYW1vdW50IjoiMjAwMDAiLCJhc3NldCI6IkJQeTFmcDFIYjF2NlJyNDFheVBzOHR0UlVyampOcWtBcHVkVGlpbk51Y2czIiwicGF5VG8iOiJBYWVldE4yVG1ZaTNOUzE5VUJneThoSzJQWmVwZnVDZTFqUnhudmZSYzk1RyIsIm1heFRpbWVvdXRTZWNvbmRzIjo1OTgsImV4dHJhIjp7Im5hbWUiOiJVU0RDIiwicHJlcGF5SWQiOiI4Mjk3MDgzMzIzMTE1MTEwNCIsImV4cGlyZVRpbWUiOjE3NzQ1ODQzNzU1NDUsImZlZVBheWVyIjoiMnNObmE1R0xHdXRSVkFINFpvVWdXeHR6MzFnWEtzUlRGczZtV212Um1BZzQiLCJ2ZXJzaW9uIjoiMiIsIm9yZGVySWQiOiJPUkQtMEFCNjYzRjIifX1dfQ==";

console.log("=== 测试中心化支付解析器 ===\n");

// 1. 测试 base64 编码
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
  console.log(JSON.stringify(paymentInfo, null, 2));
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
    prepayId: "82970833231151104",
    merchantTradeNo: "ORD-0AB663F2",
    currency: "USDC",
    totalFee: "0.02",
    payCurrency: "USDC",
    payAmount: "0.02",
    uid: "10002",
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
