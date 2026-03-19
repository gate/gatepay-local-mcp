import { X402ClientStandalone } from "../x402-standalone/client.js";
import { ExactEvmScheme } from "../x402-standalone/exactEvmScheme.js";
import { wrapFetchWithPayment } from "../x402-standalone/fetch.js";
import type { PayFetchFactory } from "./types.js";

const SUPPORTED_NETWORKS = [
  "gatelayer_testnet",
  "eth",
  "base",
  "Polygon",
  "gatelayer",
  "gatechain",
  "Arbitrum One",
] as const;

export class DefaultPayFetchFactory implements PayFetchFactory {
  build({ signer }: { signer: import("../x402-standalone/types.js").ClientEvmSigner }): typeof fetch {
    const client = new X402ClientStandalone();
    for (const network of SUPPORTED_NETWORKS) {
      client.register(network, new ExactEvmScheme(signer));
    }
    return wrapFetchWithPayment(fetch, client);
  }
}
