/**
 * Gate Layer Testnet EIP-3009 digest (no @x402/* deps).
 */
import type { Hex } from "viem";
import { concatHex, keccak256, padHex, toHex } from "viem";

export const GATELAYER_TESTNET_TOKEN_DOMAIN_SEPARATORS: Record<string, Hex> = {
  "0x9be8df37c788b244cfc28e46654ad5ec28a880af":
    "0x2c2d6b621e73a4a094449d1894717413742130fb20149ec48340ca0354d1a707" as Hex,
  "0x081ff58e7d7105ad400f4cc76becfd8684013a4d":
    "0x7c6ddc1021fbf24f4dbe62b331d83549a44e91bee3d396a33171bebe573b0fab" as Hex,
};

export function getGatelayerTestnetDomainSeparator(asset: string): Hex | undefined {
  return GATELAYER_TESTNET_TOKEN_DOMAIN_SEPARATORS[asset?.toLowerCase() ?? ""];
}

const TRANSFER_WITH_AUTHORIZATION_TYPE =
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

export interface TransferWithAuthorizationLike {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

function transferWithAuthorizationTypeHash(): Hex {
  return keccak256(new Uint8Array(new TextEncoder().encode(TRANSFER_WITH_AUTHORIZATION_TYPE)));
}

export function buildEip712DigestTransferWithAuthorization(
  domainSeparator: Hex,
  authorization: TransferWithAuthorizationLike,
): Hex {
  const typeHash = transferWithAuthorizationTypeHash();
  const encoded = concatHex([
    typeHash,
    padHex(authorization.from as Hex, { size: 32 }),
    padHex(authorization.to as Hex, { size: 32 }),
    padHex(toHex(BigInt(authorization.value)), { size: 32 }),
    padHex(toHex(BigInt(authorization.validAfter)), { size: 32 }),
    padHex(toHex(BigInt(authorization.validBefore)), { size: 32 }),
    authorization.nonce.length === 66
      ? (authorization.nonce as Hex)
      : padHex(authorization.nonce as Hex, { size: 32 }),
  ]);
  const structHash = keccak256(encoded);
  return keccak256(concatHex(["0x1901", domainSeparator, structHash]));
}
