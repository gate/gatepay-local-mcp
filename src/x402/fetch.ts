/**
 * wrapFetchWithPayment: 402 → parse → normalize → createPayload → retry (no @x402/* deps).
 */
import type { PaymentPayload, PaymentRequired } from "./types.js";
import type { X402ClientStandalone } from "./client.js";
import { getPaymentRequiredResponse, encodePaymentSignatureHeader } from "./http.js";
import { normalizePaymentRequirements } from "./utils.js";

export function wrapFetchWithPayment(
  fetchFn: typeof globalThis.fetch,
  client: X402ClientStandalone,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const clonedRequest = request.clone();

    const response = await fetchFn(request);
    if (response.status !== 402) return response;

    let paymentRequired: PaymentRequired;
    try {
      const getHeader = (name: string) => response.headers.get(name);
      const responseText = await response.text();
      let body: PaymentRequired | undefined;
      try {
        if (responseText) body = JSON.parse(responseText) as PaymentRequired;
      } catch {
        /* ignore */
      }
      paymentRequired = getPaymentRequiredResponse(getHeader, body);
    } catch (error) {
      throw new Error(
        `Failed to parse payment requirements: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    paymentRequired = {
      ...paymentRequired,
      accepts: normalizePaymentRequirements(paymentRequired.accepts),
    };

    let paymentPayload: PaymentPayload;
    try {
      console.error("paymentRequired", paymentRequired);
      paymentPayload = await client.createPaymentPayload(paymentRequired);
    } catch (error) {
      throw new Error(
        `Failed to create payment payload: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    console.error("paymentPayload finish:", paymentPayload);

    if (
      clonedRequest.headers.has("PAYMENT-SIGNATURE") ||
      clonedRequest.headers.has("X-PAYMENT")
    ) {
      throw new Error("Payment already attempted");
    }

    const encoded = encodePaymentSignatureHeader(paymentPayload);
    clonedRequest.headers.set("PAYMENT-SIGNATURE", encoded);
    clonedRequest.headers.set(
      "Access-Control-Expose-Headers",
      "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE",
    );

    return fetchFn(clonedRequest);
  };
}
