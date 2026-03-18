import { config } from "dotenv";
import { X402ClientStandalone } from "../src/x402-standalone/client.js";
import { ExactEvmScheme } from "../src/x402-standalone/exactEvmScheme.js";
import { createSignerFromPrivateKey } from "../src/x402-standalone/signer.js";
import { wrapFetchWithPayment } from "../src/x402-standalone/fetch.js";
import { safeBase64Decode } from "../src/x402-standalone/utils.js";

config();

const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:8080";
const endpointPath = process.env.ENDPOINT_PATH || "/flight/order";
const url = `${baseURL}${endpointPath}`;

function getPaymentSettleResponse(getHeader: (name: string) => string | null): unknown {
  const raw =
    getHeader("PAYMENT-RESPONSE") ?? getHeader("X-PAYMENT-RESPONSE") ?? null;
  if (!raw) return null;
  try {
    return JSON.parse(safeBase64Decode(raw)) as unknown;
  } catch {
    return { raw };
  }
}

/**
 * Example: use project-internal x402-standalone to request x402-protected endpoints.
 *
 * Registers gatelayer_testnet + exact EVM scheme only (no @x402/* deps).
 *
 * Required environment variables:
 * - EVM_PRIVATE_KEY: The private key of the EVM signer
 */
async function main(): Promise<void> {
  const evmSigner = createSignerFromPrivateKey(evmPrivateKey);
  const client = new X402ClientStandalone();
  client.register("gatelayer_testnet", new ExactEvmScheme(evmSigner));
  client.register("eth", new ExactEvmScheme(evmSigner));
  client.register("base", new ExactEvmScheme(evmSigner));
  client.register("Polygon", new ExactEvmScheme(evmSigner));
  client.register("gatelayer", new ExactEvmScheme(evmSigner));
  client.register("gatechain", new ExactEvmScheme(evmSigner));
  client.register("Arbitrum One", new ExactEvmScheme(evmSigner));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log(`Making request to: ${url}\n`);

  const response = await fetchWithPayment(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flightId: "FL002", uid: "100","chain": "ARBEVM","fullCurrType": "USDC_ARBEVM" }),
  });
  const body = await response.json();
  console.log("Response body:", body);

  if (response.ok) {
    const paymentResponse = getPaymentSettleResponse((name) =>
      response.headers.get(name),
    );
    console.log("\nPayment response:", paymentResponse);
  } else {
    console.log(`\nNo payment settled (response status: ${response.status})`);
  }
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
