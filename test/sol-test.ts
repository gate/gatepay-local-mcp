import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import type { PaymentRequired,Network } from "@x402/core/types";


const BASE_URL = "http://api-x402-test.gatenode.cc";
const CLIENT_PRIVATE_KEY = "4bwYV89JQzjX4bKqZDDYAohaGG72f3HrkmVHatW6DLNTM5DmUR5hTGuZheQyHzeeFZbgdmguPedxFr2tWopEHwTx";
const FACILITATOR_ADDRESS = "2sNna5GLGutRVAH4ZoUgWxtz31gXKsRTFs6mWmvRmAg4";
const RESOURCE_SERVER_ADDRESS = "4GRKntV5NNe2qaJqfmRAB7prwR6CVcBzdntL2XfypYnH";

interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
  timestamp: number;
}

interface VerifyData {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

interface SettleData {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
}

async function postJSON<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  const maxRetries = 3;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await resp.text();
      if (!raw.trim()) {
        lastErr = new Error(`empty response body from ${url}, status=${resp.status}`);
        if (attempt < maxRetries) { await sleep(200); continue; }
        throw lastErr;
      }
      return JSON.parse(raw) as ApiResponse<T>;
    } catch (e) {
      lastErr = e as Error;
      if (attempt < maxRetries) { await sleep(200); continue; }
    }
  }
  throw new Error(`request failed after retries: ${lastErr?.message}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const clientBytes = base58.decode(CLIENT_PRIVATE_KEY);
  const clientSigner = await createKeyPairSignerFromBytes(clientBytes);
  console.log("client address:", clientSigner.address);

  const svmScheme = new ExactSvmScheme(clientSigner, {
    rpcUrl: "https://api.devnet.solana.com",
  });

  const client = new x402Client();
  client.register("solana-devnet" as Network, svmScheme); // 修复：Network 格式需要是 scheme:network

  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: {
      url: "https://api.example.com/premium",
      description: "Premium API Access",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "solana-devnet" as Network, // 修复：Network 格式需要是 scheme:network
        asset: "BPy1fp1Hb1v6Rr41ayPs8ttRUrjjNqkApudTiinNucg3",
        amount: "1000",
        payTo: RESOURCE_SERVER_ADDRESS,
        maxTimeoutSeconds: 0,
        extra: {
          feePayer: FACILITATOR_ADDRESS,
        },
      },
    ],
  };

  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  console.log("payment payload:", JSON.stringify(paymentPayload, null, 2));

  const verifySettleReq = {
    x402Version: paymentPayload.x402Version,
    paymentPayload: {
      x402Version: paymentPayload.x402Version,
      accepted: paymentPayload.accepted,
      payload: paymentPayload.payload,
      resource: paymentPayload.resource,
      extensions: paymentPayload.extensions,
    },
    paymentRequirements: paymentRequired.accepts[0],
  };

  console.log("verify settle request:", JSON.stringify(verifySettleReq, null, 2));

  // Verify
  const verifyResp = await postJSON<VerifyData>(
    `${BASE_URL}/v1/x402/verify`,
    verifySettleReq,
  );
  if (verifyResp.code !== 0) {
    console.error("verify business error:", verifyResp);
    return;
  }
  if (!verifyResp.data.isValid) {
    console.error("verify failed:", verifyResp.data.invalidReason);
    return;
  }
  console.log("verify passed, payer:", verifyResp.data.payer);
  if (verifyResp.data.payer !== clientSigner.address) {
    console.error(`unexpected payer: want=${clientSigner.address} got=${verifyResp.data.payer}`);
    return;
  }

  // Settle
  const settleResp = await postJSON<SettleData>(
    `${BASE_URL}/v1/x402/settle`,
    verifySettleReq,
  );
  if (settleResp.code !== 0) {
    console.error("settle business error:", settleResp);
    return;
  }
  if (!settleResp.data.success) {
    console.error("settle failed:", settleResp.data.errorReason);
    return;
  }
  if (!settleResp.data.transaction) {
    console.error("expected settlement transaction signature");
    return;
  }

  console.log("settle successful:", settleResp.data.transaction);
}

main().catch(console.error);