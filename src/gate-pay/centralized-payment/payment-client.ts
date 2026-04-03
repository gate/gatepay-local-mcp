/**
 * 中心化支付 - 支付客户端
 */

import type { ExtractedPaymentInfo } from "./parser.js";
import { getEnvConfig } from "../../config/env-config.js";

/** 中心化支付业务成功码（与 HTTP 状态无关） */
function isCentralizedPaymentSuccessCode(code: string | number | undefined): boolean {
  if (code === undefined) return true;
  return code === 200 || code === "200" || code === "000000";
}

export interface CentralizedPaymentConfig {
  paymentUrl?: string;
  clientId?: string;
}

export interface PaymentResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  statusCode: number;
  responseBody?: string;
}

/**
 * 获取中心化支付 API 地址（优先使用环境变量）
 */
export function getPaymentUrl(config?: CentralizedPaymentConfig): string {
  const envUrl = process.env.GATE_PAY_CENTRALIZED_PAYMENT_URL?.trim();
  if (envUrl) return envUrl;
  if (config?.paymentUrl) return config.paymentUrl;
  return getEnvConfig().centralizedPaymentUrl;
}

/**
 * 获取 Client ID（优先使用环境变量）
 */
export function getClientId(config?: CentralizedPaymentConfig): string {
  const envClientId = process.env.GATE_PAY_CLIENT_ID?.trim();
  if (envClientId) return envClientId;
  if (config?.clientId) return config.clientId;
  return getEnvConfig().paymentClientId;
}

/**
 * 调用中心化支付 API
 */
export async function submitCentralizedPayment(
  paymentInfo: ExtractedPaymentInfo,
  accessToken: string,
  config?: CentralizedPaymentConfig
): Promise<PaymentResponse> {
  const url = getPaymentUrl(config);
  const clientId = getClientId(config);

  // USD Coin 是签名要用的币种，中心化支付只认USDC
  let payCurrency = paymentInfo.payCurrency;
  if (payCurrency === "USD Coin") {
    payCurrency = "USDC";
  }
  
  const payload = {
    prepayId: paymentInfo.prepayId,
    merchantTradeNo: paymentInfo.merchantTradeNo,
    currency: payCurrency,
    totalFee: paymentInfo.totalFee,
    payCurrency: payCurrency,
    payAmount: paymentInfo.payAmount,
    uid: paymentInfo.uid,
  };
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GatePay-Access-Token": accessToken,
        "x-gatepay-clientid": clientId,
      },
      body: JSON.stringify(payload),
    });
    
    const responseBody = await response.text();
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
        responseBody,
      };
    }
    
    let data: unknown;
    try {
      data = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      data = responseBody;
    }
    
    // 检查业务层面的错误：即使 HTTP 200，但可能业务失败
    if (data && typeof data === "object") {
      // 情况1: data.bizMessage 有值
      if ("data" in data) {
        const bizData = (data as { data?: { bizMessage?: string } }).data;
        if (bizData?.bizMessage) {
          return {
            success: false,
            error: bizData.bizMessage,
            statusCode: response.status,
            responseBody,
            data,
          };
        }
      }
      
      // 情况2: status 为 FAIL / ERROR（成功时为 SUCCESS）
      const status = (data as { status?: string }).status;
      if (status === "FAIL" || status === "ERROR") {
        const errorMsg =
          (data as { errorMessage?: string }).errorMessage?.trim() ||
          (data as { label?: string }).label ||
          (data as { message?: string }).message ||
          "Request failed";
        return {
          success: false,
          error: errorMsg,
          statusCode: response.status,
          responseBody,
          data,
        };
      }

      // 情况3: errorMessage 非空（成功时多为 ""）
      const errorMessage = (data as { errorMessage?: string }).errorMessage?.trim();
      if (errorMessage) {
        return {
          success: false,
          error: errorMessage,
          statusCode: response.status,
          responseBody,
          data,
        };
      }

      // 情况4: code 非成功码（成功示例: "000000"，兼容 200 / "200"）
      const code = (data as { code?: string | number }).code;
      if (!isCentralizedPaymentSuccessCode(code)) {
        const errorMsg =
          (data as { errorMessage?: string }).errorMessage?.trim() ||
          (data as { label?: string }).label ||
          (data as { message?: string }).message ||
          `Business error: code ${code}`;
        return {
          success: false,
          error: errorMsg,
          statusCode: response.status,
          responseBody,
          data,
        };
      }
    }
    
    return {
      success: true,
      data,
      statusCode: response.status,
      responseBody,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `网络请求失败: ${errorMessage}`,
      statusCode: 0,
    };
  }
}
