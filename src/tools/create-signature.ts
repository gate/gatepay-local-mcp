import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PaymentRequired, PaymentPayload } from "../x402/types.js";
import { X402ClientStandalone } from "../x402/client.js";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  getPaymentRequiredResponse,
} from "../x402/http.js";
import { normalizePaymentRequirements } from "../x402/utils.js";
import type { createSignModeRegistry } from "../modes/registry.js";
import { registerX402Networks } from "../utils/client-registry.js";
import {
  createErrorResponse,
  createSuccessResponse,
  handleRequestError,
  isCallToolResult,
} from "../utils/response-helpers.js";

async function selectSignModeAndGetPayFetch(
  registry: ReturnType<typeof createSignModeRegistry>,
  signMode: string | undefined,
  walletLoginProvider: "google" | "gate"
): Promise<{ payFetch: typeof fetch } | CallToolResult> {
  try {
    const selectedMode = await registry.selectMode(signMode);
    const { formatSignModeSelectionError } = await import("../modes/registry.js");
    const payFetch: typeof fetch = await registry.getOrCreatePayFetch(selectedMode.mode, {
      walletLoginProvider,
    });
    return { payFetch };
  } catch (error) {
    const { formatSignModeSelectionError } = await import("../modes/registry.js");
    return createErrorResponse(formatSignModeSelectionError(error));
  }
}

export async function handleCreateSignature(
  args: Record<string, unknown>,
  signModeRegistry: ReturnType<typeof createSignModeRegistry>
): Promise<CallToolResult> {
  try {
    const paymentRequiredHeader = args.payment_required_header != null ? String(args.payment_required_header).trim() : "";
    const responseBody = args.response_body != null ? String(args.response_body).trim() : "";
    const signMode = args.sign_mode != null ? String(args.sign_mode).trim() : undefined;
    const walletLoginProvider: "google" | "gate" = 
      String(args.wallet_login_provider ?? "gate").toLowerCase() === "google" ? "google" : "gate";
    
    // 1. 解析 PAYMENT-REQUIRED
    let paymentRequired: PaymentRequired;
    try {
      if (paymentRequiredHeader) {
        paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
      } else if (responseBody) {
        const getHeader = () => null;
        let bodyObj: PaymentRequired | undefined;
        try {
          bodyObj = JSON.parse(responseBody) as PaymentRequired;
        } catch {
          return createErrorResponse("无法解析响应体为JSON，且未提供payment_required_header参数。");
        }
        paymentRequired = getPaymentRequiredResponse(getHeader, bodyObj);
      } else {
        return createErrorResponse("缺少payment_required_header或response_body参数。");
      }
      
      paymentRequired = {
        ...paymentRequired,
        accepts: normalizePaymentRequirements(paymentRequired.accepts),
      };
    } catch (error) {
      return createErrorResponse(
        `解析PAYMENT-REQUIRED失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    
    // 2. 获取签名器并创建签名
    const signModeResult = await selectSignModeAndGetPayFetch(
      signModeRegistry,
      signMode,
      walletLoginProvider
    );
    
    if (isCallToolResult(signModeResult)) {
      return signModeResult;
    }
    
    const selectedMode = await signModeRegistry.selectMode(signMode);
    const signerSession = await selectedMode.mode.resolveSigner({ walletLoginProvider });
    
    const client = new X402ClientStandalone();
    registerX402Networks(client, signerSession);
    
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = await client.createPaymentPayload(paymentRequired);
    } catch (error) {
      return createErrorResponse(
        `创建支付payload失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    
    // 3. 返回完整的payload和编码后的签名
    const encoded = encodePaymentSignatureHeader(paymentPayload);
    
    const result = {
      paymentPayload,
      encodedSignature: encoded,
    };
    
    return createSuccessResponse(JSON.stringify(result, null, 2));
  } catch (err) {
    return await handleRequestError(err);
  }
}
