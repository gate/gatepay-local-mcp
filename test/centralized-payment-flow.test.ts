/**
 * 直接用 src 里的代码走 x402 中心化支付：先请求商户拿 402 + PAYMENT-REQUIRED，
 * 再调用 handleCentralizedPayment（Gate Pay OAuth + 中心化扣款 + 带 X-GatePay-Centralized-Merchant-No 重试）。
 * 不经过 MCP 子进程，方便断点调试。
 *
 * 前置：
 * - 商户可返回 402 且带 PAYMENT-REQUIRED 头（与 x402_place_order 一致）
 * - Gate Pay 授权：与 x402_gate_pay_auth 相同（.env 中 OAuth / token 相关变量）
 *
 * 可选环境变量：
 * - RESOURCE_SERVER_URL：目标服务器地址，默认 http://localhost:8080
 * - ENDPOINT_PATH：接口路径，默认 /flight/order
 * - REQUEST_BODY：POST JSON 字符串（默认与 privateKey.test.ts 一致，BASEEVM）
 * - 可在项目根目录 .env 中配置
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleCentralizedPayment } from "../src/tools/centralized-payment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
config({ path: join(packageRoot, ".env") });

const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:8080";
const endpointPath = process.env.ENDPOINT_PATH || "/flight/order";
const defaultBody =
  '{"flightId": "FL002","uid": "100","chain":"BASEEVM","fullCurrType":"USDC_BASEEVM"}';
const requestBody = (process.env.REQUEST_BODY?.trim() || defaultBody).trim();

const resourceUrl = `${baseURL}${endpointPath}`;
const method = "POST" as const;

function buildRequestInit(m: string, body?: string): RequestInit {
  if (m === "GET") {
    return { method: "GET" };
  }
  if (m === "POST" || m === "PUT" || m === "PATCH") {
    if (body?.trim()) {
      JSON.parse(body);
    }
    return {
      method: m,
      headers: { "Content-Type": "application/json" },
      body: body?.trim() ? body : undefined,
    };
  }
  throw new Error(`不支持的 method: ${m}`);
}

function getPaymentRequiredHeader(response: Response): string | null {
  const v =
    response.headers.get("PAYMENT-REQUIRED") ??
    response.headers.get("payment-required");
  const s = v?.trim();
  return s || null;
}

async function main(): Promise<void> {
  process.env.GATE_PAY_ENV = 'test'
  console.log("🔐 中心化支付流程（需 Gate Pay 已配置且可完成 OAuth / refresh）\n");

  const init = buildRequestInit(method, requestBody);
  console.log(`1) 下单请求: ${resourceUrl} ${method}`);
  console.log(`   请求体: ${requestBody}\n`);

  const first = await fetch(resourceUrl, init);
  const firstText = await first.text();

  if (first.status !== 402) {
    console.error(
      `❌ 期望 HTTP 402，实际 ${first.status}。响应片段:\n${firstText.slice(0, 500)}`,
    );
    process.exit(1);
  }

  const paymentRequiredHeader = getPaymentRequiredHeader(first);
  if (!paymentRequiredHeader) {
    console.error("❌ 402 响应中未找到 PAYMENT-REQUIRED / payment-required 头");
    process.exit(1);
  }

  console.log("2) 已拿到 PAYMENT-REQUIRED，调用中心化支付工具逻辑…\n");

  const result = await handleCentralizedPayment({
    payment_required_header: paymentRequiredHeader,
    resource_url: resourceUrl,
    method,
    body: requestBody,
  });

  const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
  if (result.isError) {
    console.error("--- 中心化支付失败 ---\n", text);
    process.exit(1);
  }

  console.log("--- 商户重试响应（工具返回文本）---\n", text);
  console.log(`\n✓ 完成：已通过中心化支付访问 ${resourceUrl}。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
