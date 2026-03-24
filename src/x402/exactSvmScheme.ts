/**
 * Exact SVM (Solana) scheme: create payment payload + sign.
 * Using official @x402/svm implementation.
 */
import { ExactSvmScheme as OfficialExactSvmScheme } from "@x402/svm";
import type { PaymentRequirements as OfficialPaymentRequirements } from "@x402/core/types";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
  ClientSvmSigner,
} from "./types.js";

/**
 * ExactSvmScheme - 使用官方 @x402/svm 实现
 * 
 * 用法与 sol-test.ts 相同：
 * ```typescript
 * const svmScheme = new ExactSvmScheme(signer, {
 *   rpcUrl: "https://api.devnet.solana.com",
 * });
 * ```
 */
export class ExactSvmScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  private readonly officialScheme: OfficialExactSvmScheme;

  constructor(
    signer: ClientSvmSigner,
    config?: { rpcUrl?: string },
  ) {
    // 直接使用官方的 ExactSvmScheme 实现
    this.officialScheme = new OfficialExactSvmScheme(signer, config);
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    // 将本地类型转换为官方类型
    console.log("createPaymentPayload paymentRequirements", paymentRequirements);
    const officialRequirements: OfficialPaymentRequirements = {
      ...paymentRequirements,
      // network 需要确保是 scheme:network 格式
      network: paymentRequirements.network as `${string}:${string}`,
    };
    
    // 委托给官方实现
    return this.officialScheme.createPaymentPayload(x402Version, officialRequirements);
  }
}
