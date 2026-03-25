import { X402ClientStandalone } from "../x402/client.js";
import { ExactEvmScheme } from "../x402/exactEvmScheme.js";
import { ExactSvmScheme } from "../x402/exactSvmScheme.js";
import { wrapFetchWithPayment } from "../x402/fetch.js";
import type { PayFetchFactory } from "./types.js";

const SUPPORTED_EVM_NETWORKS = [
  "gatelayer_testnet",
  "eth",
  "base",
  "Polygon",
  "gatelayer",
  "gatechain",
  "Arbitrum One",
] as const;

const SUPPORTED_SOLANA_NETWORKS = [
  { name: "solana", rpcUrl: "https://api.mainnet-beta.solana.com" },
  { name: "solana-devnet", rpcUrl: "https://api.devnet.solana.com" },
] as const;

export class DefaultPayFetchFactory implements PayFetchFactory {
  build(config: {
    signer?: import("../x402/types.js").ClientEvmSigner;
    solanaSigner?: import("../x402/types.js").ClientSvmSigner;
  }): typeof fetch {
    const client = new X402ClientStandalone();

    // Register EVM networks
    if (config.signer) {
      for (const network of SUPPORTED_EVM_NETWORKS) {
        client.register(network, new ExactEvmScheme(config.signer));
      }
    }

    // Register Solana networks with appropriate RPC URLs
    if (config.solanaSigner) {
      for (const network of SUPPORTED_SOLANA_NETWORKS) {
        client.register(network.name, new ExactSvmScheme(config.solanaSigner, {
          rpcUrl: network.rpcUrl,
        }));
      }
    }

    return wrapFetchWithPayment(fetch, client);
  }
}
