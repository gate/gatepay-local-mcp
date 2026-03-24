/**
 * Minimal x402 client: single network + scheme (gatelayer_testnet + exact), no @x402/* deps.
 */
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SchemeNetworkClient } from "./types.js";
import { findByNetworkAndScheme } from "./utils.js";

const X402_VERSION = 2;

export class X402ClientStandalone {
  private readonly schemesByNetwork: Map<string, Map<string, SchemeNetworkClient>> = new Map();

  register(network: string, client: SchemeNetworkClient): this {
    if (!this.schemesByNetwork.has(network)) {
      this.schemesByNetwork.set(network, new Map());
    }
    this.schemesByNetwork.get(network)!.set(client.scheme, client);
    return this;
  }

  async createPaymentPayload(paymentRequired: PaymentRequired): Promise<PaymentPayload> {
    // 按accepts的顺序依次尝试，直到找到第一个支持的
    const requirements = this.selectPaymentRequirements(
      paymentRequired.x402Version,
      paymentRequired.accepts,
    );
    const schemeClient = findByNetworkAndScheme(
      this.schemesByNetwork,
      requirements.scheme,
      requirements.network,
    );
    if (!schemeClient) {
      throw new Error(
        `No client registered for scheme ${requirements.scheme} and network ${requirements.network}`,
      );
    }
    const partial = await schemeClient.createPaymentPayload(
      paymentRequired.x402Version,
      requirements,
    );
    return {
      ...partial,
      resource: paymentRequired.resource,
      accepted: requirements,
      extensions: paymentRequired.extensions,
    };
  }

  private selectPaymentRequirements(
    x402Version: number,
    accepts: PaymentRequirements[],
  ): PaymentRequirements {
    const byNetwork = this.schemesByNetwork;
    console.log("byNetwork", byNetwork);
    const supported = accepts.filter((r) => {
      const schemes = byNetwork.get(r.network);
      return schemes?.has(r.scheme);
    });
    if (supported.length === 0) {
      throw new Error(
        `No registered client supports any of the payment requirements (x402 v${x402Version})`,
      );
    }
    return supported[0];
  }
}

export { X402_VERSION };
