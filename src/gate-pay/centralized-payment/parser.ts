/**
 * 中心化支付 - PAYMENT-REQUIRED header 解析器
 */

export interface PaymentRequiredData {
  x402Version: number;
  error?: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
    orderId: string;
  };
  accepts: Array<{
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo?: string;
    maxTimeoutSeconds?: number;
    extra?: {
      name?: string;
      prepayId: string;
      expireTime?: number;
      feePayer?: string;
      version?: string;
      orderId?: string;
      [key: string]: unknown;
    };
  }>;
}

export interface ExtractedPaymentInfo {
  prepayId: string;
  merchantTradeNo: string;
  currency: string;
  totalFee: string;
  payCurrency: string;
  payAmount: string;
  uid: number;
}

/**
 * 解析 base64 编码的 PAYMENT-REQUIRED header
 */
export function parsePaymentRequiredHeader(base64Header: string): PaymentRequiredData {
  try {
    const decoded = Buffer.from(base64Header, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as PaymentRequiredData;
    
    if (!parsed.accepts || !Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
      throw new Error("PAYMENT-REQUIRED header 缺少 accepts 数组");
    }
    
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`解析 PAYMENT-REQUIRED header 失败: ${error.message}`);
    }
    throw new Error("解析 PAYMENT-REQUIRED header 失败: 未知错误");
  }
}

/**
 * 从解析后的数据中提取支付信息
 * amount 需要除以 10^6 转换为实际金额
 */
export function extractPaymentInfo(
  data: PaymentRequiredData,
  uid: number = 10002
): ExtractedPaymentInfo {
  const firstAccept = data.accepts[0];
  
  if (!firstAccept) {
    throw new Error("accepts 数组为空，无法提取支付信息");
  }
  
  if (!firstAccept.extra?.prepayId) {
    throw new Error("缺少必需的 extra.prepayId 字段");
  }
  
  const orderId = data.resource.orderId || firstAccept.extra?.orderId || "";
  if (!orderId) {
    throw new Error("缺少 orderId 字段");
  }
  
  // 金额转换：除以 10^6
  const amountInSmallestUnit = BigInt(firstAccept.amount);
  const divisor = BigInt(1_000_000);
  const amountInMainUnit = amountInSmallestUnit / divisor;
  const totalFee = amountInMainUnit.toString();
  
  // 提取币种名称
  const currency = firstAccept.extra?.name || "USDC";
  
  return {
    prepayId: firstAccept.extra.prepayId,
    merchantTradeNo: orderId,
    currency,
    totalFee,
    payCurrency: currency,
    payAmount: totalFee,
    uid,
  };
}
