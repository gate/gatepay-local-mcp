/**
 * 中心化支付工具使用示例
 * 
 * 此示例展示如何准备数据并调用中心化支付工具
 */

import {
  parsePaymentRequiredHeader,
  extractPaymentInfo,
  submitCentralizedPayment,
} from "../src/gate-pay/centralized-payment/index.js";

// 模拟从 402 响应获取的 PAYMENT-REQUIRED 数据
const mockPaymentRequired = {
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

async function main() {
  console.log("=== 中心化支付工具使用示例 ===\n");

  // 步骤 1: 将 PAYMENT-REQUIRED 数据编码为 base64
  console.log("步骤 1: 编码 PAYMENT-REQUIRED header");
  const base64Header = Buffer.from(JSON.stringify(mockPaymentRequired)).toString("base64");
  console.log(`Base64 Header (前 80 字符): ${base64Header.substring(0, 80)}...\n`);

  // 步骤 2: 解析 header
  console.log("步骤 2: 解析 PAYMENT-REQUIRED header");
  const parsed = parsePaymentRequiredHeader(base64Header);
  console.log(`✓ 解析成功`);
  console.log(`  版本: ${parsed.x402Version}`);
  console.log(`  订单 ID: ${parsed.resource.orderId}`);
  console.log(`  支付选项数量: ${parsed.accepts.length}\n`);

  // 步骤 3: 提取支付信息
  console.log("步骤 3: 提取支付信息");
  const paymentInfo = extractPaymentInfo(parsed);
  console.log(`✓ 提取成功`);
  console.log(`  预支付 ID: ${paymentInfo.prepayId}`);
  console.log(`  商户交易号: ${paymentInfo.merchantTradeNo}`);
  console.log(`  币种: ${paymentInfo.currency}`);
  console.log(`  金额: ${paymentInfo.totalFee} ${paymentInfo.currency}`);
  console.log(`  UID: ${paymentInfo.uid}\n`);

  // 步骤 4: 调用支付 API (需要 access_token)
  console.log("步骤 4: 调用中心化支付 API");
  console.log("注意: 此步骤需要有效的 Gate Pay access_token");
  console.log("在实际使用中，access_token 会从 pay-token-store 中自动获取\n");

  // 模拟的 API 调用（不实际发送请求）
  console.log("模拟 API 请求:");
  console.log("  URL: http://dev.halftrust.xyz/payment-service/payment/gatepay/v2/pay/ai/order/pay");
  console.log("  方法: POST");
  console.log("  请求头:");
  console.log("    Content-Type: application/json");
  console.log("    X-GatePay-Access-Token: <access_token>");
  console.log("    x-gatepay-clientid: mZ96D37oKk-HrWJc");
  console.log("  请求体:");
  console.log(JSON.stringify(paymentInfo, null, 2));

  console.log("\n=== 完整工作流程 ===");
  console.log("1. 从 402 响应获取 PAYMENT-REQUIRED header (base64 编码)");
  console.log("2. 调用 MCP tool: x402_centralized_payment");
  console.log("3. Tool 自动:");
  console.log("   - 解析 header");
  console.log("   - 提取支付信息");
  console.log("   - 检查/刷新 access_token");
  console.log("   - 调用支付 API");
  console.log("   - 返回支付结果");

  console.log("\n=== MCP Tool 调用示例 ===");
  console.log(JSON.stringify({
    "name": "x402_centralized_payment",
    "arguments": {
      "payment_required_header": base64Header.substring(0, 80) + "..."
    }
  }, null, 2));
}

main().catch((error) => {
  console.error("示例运行失败:", error);
  process.exit(1);
});
