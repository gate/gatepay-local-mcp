import { X402ClientStandalone } from "../x402/client.js";
import { wrapFetchWithPayment } from "../x402/fetch.js";
import { registerX402Networks } from "../utils/client-registry.js";
import type { BuildPayFetchInput, PayFetchFactory } from "./types.js";

export class DefaultPayFetchFactory implements PayFetchFactory {
  build(config: BuildPayFetchInput): typeof fetch {
    const client = new X402ClientStandalone();

    // Use unified network registration logic
    registerX402Networks(client, {
      signer: config.signer,
      solanaSigner: config.solanaSigner,
    });

    return wrapFetchWithPayment(fetch, client, { signModeId: config.signModeId });
  }
}
