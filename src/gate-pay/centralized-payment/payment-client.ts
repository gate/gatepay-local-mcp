/**
 * 中心化支付 - 支付客户端
 */

import type { ExtractedPaymentInfo } from "./parser.js";

const DEFAULT_PAYMENT_URL = "http://dev.halftrust.xyz/payment-service/payment/gatepay/v2/pay/ai/order/pay";
const DEFAULT_CLIENT_ID = "mZ96D37oKk-HrWJc";

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
  return envUrl || config?.paymentUrl || DEFAULT_PAYMENT_URL;
}

/**
 * 获取 Client ID（优先使用环境变量）
 */
export function getClientId(config?: CentralizedPaymentConfig): string {
  const envClientId = process.env.GATE_PAY_CLIENT_ID?.trim();
  return envClientId || config?.clientId || DEFAULT_CLIENT_ID;
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
  
  const payload = {
    prepayId: paymentInfo.prepayId,
    merchantTradeNo: paymentInfo.merchantTradeNo,
    currency: paymentInfo.currency,
    totalFee: paymentInfo.totalFee,
    payCurrency: paymentInfo.payCurrency,
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
