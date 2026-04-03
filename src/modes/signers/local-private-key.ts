import { signAsync } from "@noble/secp256k1";
import type { Hex } from "viem";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import type { ClientEvmSigner, ClientSvmSigner } from "../../x402/types.js";
import { toHexFromBytes } from "./shared-utils.js";

type NobleSig = { toCompactRawBytes(): Uint8Array; recovery?: number };

async function signDigestWithPrivateKey(
  digest: Hex,
  privateKey: Hex,
): Promise<`0x${string}`> {
  const msg = hexToBytes(digest);
  if (msg.length !== 32) throw new Error(`Digest must be 32 bytes, got ${msg.length}`);
  const key = hexToBytes(
    privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
  );
  const sig = (await signAsync(msg, key)) as unknown as NobleSig;
  const compact = sig.toCompactRawBytes();
  if (compact.length !== 64) {
    throw new Error(`Expected 64-byte compact signature, got ${compact.length}`);
  }
  const recovery = sig.recovery ?? 0;
  const v = 27 + (recovery & 1);
  const rHex = toHexFromBytes(compact.slice(0, 32));
  const sHex = toHexFromBytes(compact.slice(32, 64));
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${rHex}${sHex}${vHex}` as `0x${string}`;
}

/**
 * 创建本地私钥 Signer (用于 local_private_key 签名模式)
 */
export function createLocalPrivateKeySigner(privateKey: Hex): ClientEvmSigner {
  const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
  const account = privateKeyToAccount(key as `0x${string}`);
  return {
    address: account.address,
    signTypedData: (msg) => account.signTypedData(msg),
    signDigest: (digest) => signDigestWithPrivateKey(digest, key),
  };
}

export const createSignerFromPrivateKey = createLocalPrivateKeySigner;

/**
 * 创建本地 Solana 私钥 Signer (用于 Solana 网络的 local_private_key 签名模式)
 */
export async function createLocalSolanaPrivateKeySigner(
  privateKeyBase58: string,
): Promise<ClientSvmSigner> {
  const privateKeyBytes = base58.decode(privateKeyBase58);
  return await createKeyPairSignerFromBytes(privateKeyBytes);
}
