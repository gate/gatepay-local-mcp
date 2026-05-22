/**
 * MCP Tool: x402_centralized_payment
 * 执行中心化支付
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ensureGatePayAccessTokenAndUid } from "../gate-pay/auth.js";
import {
  parsePaymentRequiredHeader,
  extractPaymentInfo,
  submitCentralizedPayment,
} from "../gate-pay/centralized-payment/index.js";
import {
  createErrorResponse,
  handleRequestError,
} from "../utils/response-helpers.js";
import { recordTrackingGateUid } from "../tracking/tracking-invocation-context.js";

export async function handleCentralizedPayment(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    // 1. 参数验证
    const paymentRequiredHeader = args.payment_required_header != null
      ? String(args.payment_required_header).trim()
      : "";
    
    if (!paymentRequiredHeader) {
      return createErrorResponse("缺少必需参数 payment_required_header（Base64 编码的 PAYMENT-REQUIRED header）。");
    }

    const resourceUrl =
      args.resource_url != null ? String(args.resource_url).trim() : "";
    if (!resourceUrl || !resourceUrl.startsWith("http")) {
      return createErrorResponse(
        "缺少或无效参数 resource_url（需完整 http/https URL，与 x402_place_order 的 url 相同要求）。"
      );
    }

    // 2. 解析 PAYMENT-REQUIRED header
    let paymentData;
    try {
      paymentData = parsePaymentRequiredHeader(paymentRequiredHeader);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createErrorResponse(`解析 PAYMENT-REQUIRED header 失败: ${errorMessage}`);
    }
    
    // 3. 确保有效的 Gate Pay access_token 和 uid
    let authResult;
    try {
      authResult = await ensureGatePayAccessTokenAndUid();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createErrorResponse(
        `中心化支付需要 Gate Pay 授权，但获取失败: ${errorMessage}\n` +
        `请执行 x402_gate_pay_auth（浏览器 OAuth + 远程换 token），必要时检查 GATE_PAY_OAUTH_TOKEN_BASE_URL 等环境变量后重试。`
      );
    }

    if (authResult.uid.trim()) {
      recordTrackingGateUid(authResult.uid);
    }

    // 4. 提取支付信息（使用获取到的 uid）
    let paymentInfo;
    try {
      paymentInfo = extractPaymentInfo(paymentData, authResult.uid);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createErrorResponse(`提取支付信息失败: ${errorMessage}`);
    }
    
    // 5. 调用中心化支付 API
    const paymentResponse = await submitCentralizedPayment(
      paymentInfo,
      authResult.accessToken
    );
    
    if (!paymentResponse.success) {
      return createErrorResponse(
        `中心化支付失败: ${paymentResponse.error}\n` +
        `状态码: ${paymentResponse.statusCode}\n` +
        (paymentResponse.responseBody ? `响应: ${paymentResponse.responseBody}` : "")
      );
    }
    
    // 6. Retry merchant resource_url with X-GatePay-Centralized-Merchant-No after successful pay
    const methodRaw =
      args.method != null ? String(args.method).toUpperCase() : "POST";
    const method = ["GET", "POST", "PUT", "PATCH"].includes(methodRaw)
      ? methodRaw
      : "POST";
    const bodyStr =
      args.body != null && String(args.body).trim() !== ""
        ? String(args.body)
        : undefined;
    const hasJsonBody =
      bodyStr !== undefined &&
      (method === "POST" || method === "PUT" || method === "PATCH");
    const headers: Record<string, string> = {
      "X-GatePay-Centralized-Merchant-No": paymentInfo.merchantTradeNo,
    };
    if (hasJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    const init: RequestInit = { method, headers };
    if (hasJsonBody) {
      init.body = bodyStr;
    }
    const resourceResponse = await fetch(resourceUrl, init);
    const resourceBody = await resourceResponse.text();

    // 7. 返回成功结果
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            resourceBody,
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return await handleRequestError(err);
  }
}
