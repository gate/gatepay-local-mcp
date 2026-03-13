import { config } from "dotenv";
import {
  X402ClientStandalone,
  ExactEvmScheme,
  createSignerFromPrivateKey,
  wrapFetchWithPayment,
} from "./x402-standalone/index.js";
import { safeBase64Decode } from "./x402-standalone/utils.js";

config();

const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/weather";
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
  client.register("eth", new ExactEvmScheme(evmSigner));
  client.register("base", new ExactEvmScheme(evmSigner));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const flightOrderUrl = "http://localhost:8080/flight/order";
  console.log(`Making request to: ${flightOrderUrl}\n`);

  const response = await fetchWithPayment(flightOrderUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flightId: "FL001", uid: "100" }),
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
