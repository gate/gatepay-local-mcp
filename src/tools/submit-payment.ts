import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runGatePayDeviceAuthIfNeeded } from "../gate-pay/auth.js";
import { getGatePayAccessToken } from "../gate-pay/pay-token-store.js";
import { buildRequestInit } from "../utils/validation.js";
import {
  createErrorResponse,
  handleRequestError,
  handleResponseWithBalanceCheck,
} from "../utils/response-helpers.js";

export async function handleSubmitPayment(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const url = String(args.url ?? "").trim();
    const method = String(args.method ?? "POST").trim().toUpperCase();
    const body = args.body != null ? String(args.body) : "";
    const paymentSignature = String(args.payment_signature ?? "").trim();
    const signMode = args.sign_mode != null ? String(args.sign_mode).trim() : undefined;

    if (!url || !url.startsWith("http")) {
      return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
    }

    if (!paymentSignature) {
      return createErrorResponse("缺少 payment_signature 参数。");
    }

    if (signMode && signMode !== "centralized_payment") {
      return createErrorResponse(
        `x402_submit_payment 的 sign_mode 仅支持 centralized_payment（或未传）；收到: ${signMode}`,
      );
    }

    // 构建请求并添加签名头
    const init = buildRequestInit(method, body);
    const request = new Request(url, init);
    request.headers.set("PAYMENT-SIGNATURE", paymentSignature);
    request.headers.set("Access-Control-Expose-Headers", "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE");

    if (signMode === "centralized_payment") {
      await runGatePayDeviceAuthIfNeeded();
      const payToken = getGatePayAccessToken();
      if (!payToken) {
        return createErrorResponse(
          "中心化支付需要 Gate Pay 授权，但未能获取 access_token。请执行 x402_gate_pay_auth（浏览器 OAuth + 远程换 token），必要时检查 GATE_PAY_OAUTH_TOKEN_BASE_URL 等环境变量后重试。",
        );
      }
      request.headers.set("Authorization", `Bearer ${payToken}`);
    }

    // 发送支付请求
    const finalResponse = await fetch(request);
    const finalResponseText = await finalResponse.text();
    
    return await handleResponseWithBalanceCheck(finalResponse, finalResponseText);
  } catch (err) {
    return await handleRequestError(err);
  }
}
