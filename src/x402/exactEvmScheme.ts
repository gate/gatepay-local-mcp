/**
 * Exact EVM scheme: create payment payload + sign (no @x402/* deps).
 */
import type { PaymentPayload, PaymentRequirements } from "./types.js";
import type { ExactEvmPayloadV2 } from "./types.js";
import type { ClientEvmSigner, SchemeNetworkClient } from "./types.js";
import { getAddress } from "viem";
import {
  buildEip712DigestTransferWithAuthorization,
  getGatelayerTestnetDomainSeparator,
} from "./gatelayer.js";
import { createNonce, getEvmChainIdFromNetwork } from "./utils.js";

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export class ExactEvmScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(private readonly signer: ClientEvmSigner) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const nonce = createNonce();
    const now = Math.floor(Date.now() / 1000);
    const maxTimeoutSeconds = Number(paymentRequirements.maxTimeoutSeconds);
    const maxTimeout =
      Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0 ? maxTimeoutSeconds : 600;
    const amount = paymentRequirements.amount;
    const amountStr = amount != null && amount !== "" ? String(amount) : undefined;
    if (amountStr === undefined) {
      throw new Error(
        "Payment requirements missing amount (required for EIP-3009 value). Check server 402 response accepts[].amount.",
      );
    }

    const authorization: ExactEvmPayloadV2["authorization"] = {
      from: this.signer.address,
      to: getAddress(paymentRequirements.payTo),
      value: amountStr,
      validAfter: (now - 600).toString(),
      validBefore: (now + maxTimeout).toString(),
      nonce,
    };

    const signature = await this.signAuthorization(authorization, paymentRequirements);
    const payload = { authorization, signature } as unknown as Record<string, unknown>;
    return { x402Version, payload };
  }

  private async signAuthorization(
    authorization: ExactEvmPayloadV2["authorization"],
    requirements: PaymentRequirements,
  ): Promise<`0x${string}`> {
    const domainSeparator =
      String(requirements.network) === "gatelayer_testnet"
        ? getGatelayerTestnetDomainSeparator(requirements.asset ?? "")
        : undefined;

    if (domainSeparator) {
      if (typeof this.signer.signDigest !== "function") {
        throw new Error(
          "For gatelayer_testnet use a signer with signDigest (e.g. createSignerFromPrivateKey).",
        );
      }
      const intent = {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce as `0x${string}`,
      }
      const digest = buildEip712DigestTransferWithAuthorization(
        domainSeparator,
        intent 
      );
      return this.signer.signDigest(digest, JSON.stringify(intent));
    }

    const chainId = getEvmChainIdFromNetwork(requirements.network);
    if (!requirements.extra?.name || !requirements.extra?.version) {
      throw new Error(
        `EIP-712 domain parameters (name, version) are required in payment requirements for asset ${requirements.asset}`,
      );
    }
    const { name, version } = requirements.extra as { name: string; version: string };
    const domain = {
      name,
      version,
      chainId,
      verifyingContract: getAddress(requirements.asset),
    };
    const message = {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    };
    return await this.signer.signTypedData({
      domain,
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message,
    });
  }
}
