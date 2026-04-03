/**
 * Standalone x402 HTTP: decode/encode payment required & payload (no @x402/* deps).
 */
import type { PaymentPayload, PaymentRequired } from "./types.js";
import { Base64EncodedRegex, safeBase64Decode, safeBase64Encode } from "./utils.js";

export function decodePaymentRequiredHeader(paymentRequiredHeader: string): PaymentRequired {
  if (!Base64EncodedRegex.test(paymentRequiredHeader)) {
    throw new Error("Invalid payment required header");
  }
  return JSON.parse(safeBase64Decode(paymentRequiredHeader)) as PaymentRequired;
}

export function encodePaymentSignatureHeader(paymentPayload: PaymentPayload): string {
  return safeBase64Encode(JSON.stringify(paymentPayload));
}

export function getPaymentRequiredResponse(
  getHeader: (name: string) => string | null | undefined,
  body?: unknown,
): PaymentRequired {
  const paymentRequired = getHeader("PAYMENT-REQUIRED");
  if (paymentRequired) {
    return decodePaymentRequiredHeader(paymentRequired);
  }
  if (
    body &&
    typeof body === "object" &&
    "x402Version" in body &&
    "resource" in body &&
    "accepts" in body &&
    Array.isArray((body as PaymentRequired).accepts)
  ) {
    return body as PaymentRequired;
  }
  throw new Error("Invalid payment required response");
}
