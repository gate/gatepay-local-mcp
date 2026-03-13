/**
 * Standalone x402 utils: base64, createNonce, client lookup (no @x402/* deps).
 */
import type { PaymentRequirements } from "./types.js";
import { toHex } from "viem";

export const Base64EncodedRegex = /^[A-Za-z0-9+/]*={0,2}$/;

export function safeBase64Encode(data: string): string {
  if (typeof globalThis !== "undefined" && typeof globalThis.btoa === "function") {
    const bytes = new TextEncoder().encode(data);
    const binaryString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    return globalThis.btoa(binaryString);
  }
  return Buffer.from(data, "utf8").toString("base64");
}

export function safeBase64Decode(data: string): string {
  if (typeof globalThis !== "undefined" && typeof globalThis.atob === "function") {
    const binaryString = globalThis.atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  return Buffer.from(data, "base64").toString("utf-8");
}

export function findSchemesByNetwork<T>(
  map: Map<string, Map<string, T>>,
  network: string,
): Map<string, T> | undefined {
  return map.get(network);
}

export function findByNetworkAndScheme<T>(
  map: Map<string, Map<string, T>>,
  scheme: string,
  network: string,
): T | undefined {
  return findSchemesByNetwork(map, network)?.get(scheme);
}

export function createNonce(): `0x${string}` {
  const cryptoObj =
    typeof globalThis.crypto !== "undefined"
      ? globalThis.crypto
      : (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj) throw new Error("Crypto API not available");
  return toHex(cryptoObj.getRandomValues(new Uint8Array(32)));
}

const DEFAULT_MAX_TIMEOUT_SECONDS = 600;

export const CHAIN_ID_GATELAYER_TESTNET = 10087;
export const CHAIN_ID_GATELAYER = 10088;

export function getEvmChainIdFromNetwork(network: string): number {
  const s = network.trim();
  if (s === "gatelayer_testnet" || s === "eip155:10087") return CHAIN_ID_GATELAYER_TESTNET;
  if (s.startsWith("eip155:")) {
    const chainIdStr = s.slice(7).trim();
    const chainId = parseInt(chainIdStr, 10);
    if (Number.isNaN(chainId) || chainIdStr === "" || String(chainId) !== chainIdStr) {
      throw new Error(`unsupported network format: ${network} (expected eip155:CHAIN_ID)`);
    }
    return chainId;
  }
  if (s === "gatelayer") return CHAIN_ID_GATELAYER;
  throw new Error(`unsupported network format: ${network} (expected eip155:CHAIN_ID or gatelayer_testnet)`);
}

export function normalizePaymentRequirements(accepts: PaymentRequirements[]): PaymentRequirements[] {
  return accepts.map((a) => {
    const amount = a.amount;
    const amountStr = amount != null && amount !== "" ? String(amount) : "0";
    const maxTimeoutSeconds = Number(a.maxTimeoutSeconds);
    const maxTimeout =
      Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0
        ? maxTimeoutSeconds
        : DEFAULT_MAX_TIMEOUT_SECONDS;
    return { ...a, amount: amountStr, maxTimeoutSeconds: maxTimeout };
  });
}
