import { X402ClientStandalone } from "../x402/client.js";
import { ExactEvmScheme } from "../x402/exactEvmScheme.js";
import { ExactSvmScheme } from "../x402/exactSvmScheme.js";
import type { ClientEvmSigner, ClientSvmSigner } from "../x402/types.js";

const SUPPORTED_NETWORKS = [
  "gatelayer_testnet",
  "eth",
  "base",
  "Polygon",
  "gatelayer",
  "gatechain",
  "Arbitrum One",
] as const;

export function registerX402Networks(
  client: X402ClientStandalone,
  signers: {
    signer?: ClientEvmSigner;
    solanaSigner?: ClientSvmSigner;
  }
): void {
  // Register EVM networks
  if (signers.signer) {
    const evmScheme = new ExactEvmScheme(signers.signer);
    for (const network of SUPPORTED_NETWORKS) {
      client.register(network, evmScheme);
    }
  }

  // Register Solana networks if solanaSigner is available
  if (signers.solanaSigner) {
    const solanaNetworks = [
      { name: "solana", rpcUrl: "https://api.mainnet-beta.solana.com" },
      { name: "solana-devnet", rpcUrl: "https://api.devnet.solana.com" },
    ];

    for (const network of solanaNetworks) {
      const svmScheme = new ExactSvmScheme(signers.solanaSigner, {
        rpcUrl: network.rpcUrl,
      });
      client.register(network.name, svmScheme);
    }
  }
}
