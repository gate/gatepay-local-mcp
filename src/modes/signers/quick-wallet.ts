import { base58 } from "@scure/base";
import type { ClientEvmSigner, ClientSvmSigner } from "../../x402/types.js";
import type { GateMcpClient } from "../../wallets/wallet-mcp-clients.js";
import { buildEip712TypedDataDigest } from "../../x402/utils.js";
import {
  parseMcpToolResult,
  extractSignatureFromMcpResult,
  extractQuickWalletSolanaSignature,
  getBase58EncodedWireTransaction,
} from "./shared-utils.js";

/**
 * 创建快速托管钱包 Signer (用于 quick_wallet 签名模式)
 */
export async function createQuickWalletSigner(
  mcp: GateMcpClient,
  options?: { evmAddress?: `0x${string}` },
): Promise<ClientEvmSigner> {
  let address: `0x${string}`;
  if (options?.evmAddress) {
    address = options.evmAddress;
  } else {
    const addrResult = await mcp.walletGetAddresses();
    const data = parseMcpToolResult<{ addresses?: Record<string, string> }>(addrResult);
    const evm = data?.addresses?.EVM;
    if (!evm || !evm.startsWith("0x")) {
      throw new Error(
        "createQuickWalletSigner: no EVM address in wallet.get_addresses response",
      );
    }
    address = evm as `0x${string}`;
  }

  const signDigest = async (digest: `0x${string}`): Promise<`0x${string}`> => {
    const result = await mcp.walletSignMessage("EVM", digest);
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
        "createQuickWalletSigner: wallet.sign_message(digest) did not return a signature",
      );
    }
    return sig;
  };

  const signTypedData = async (msg: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> => {

    const digest = buildEip712TypedDataDigest(msg as Parameters<typeof buildEip712TypedDataDigest>[0]);
    const digestForMcp = digest.replace(/^0x/i, "");
    console.error("[createSignerFromMcpWallet] typedData digest:", digestForMcp);
    const result = await mcp.walletSignMessage("EVM", digestForMcp);

    const data = parseMcpToolResult<Record<string, unknown>>(result);
    const sig = data && extractSignatureFromMcpResult(data);
    let normalizedSig = sig;
    if (sig && /^0x[0-9a-fA-F]{130}$/.test(sig)) {
      const vHex = sig.slice(130, 132);
      const v = Number.parseInt(vHex, 16);
      if (v === 0 || v === 1) {
        const normalizedV = (v + 27).toString(16).padStart(2, "0");
        normalizedSig = `${sig.slice(0, 130)}${normalizedV}` as `0x${string}`;
      }
    }
    console.error("[createSignerFromMcpWallet] sig:", normalizedSig);

    if (!sig) {
      throw new Error(
        "createSignerFromMcpWallet: wallet.sign_message(typedData digest) did not return a signature",
      );
    }
    return normalizedSig as `0x${string}`;
  };

  return {
    address,
    signTypedData,
    signDigest,
  };
}

export const createSignerFromMcpWallet = createQuickWalletSigner;

/**
 * 创建快速托管钱包 Solana Signer (用于 quick_wallet 签名模式的 Solana 网络)
 */
export async function createQuickWalletSolanaSigner(
  mcp: GateMcpClient,
  options?: { solAddress?: string },
): Promise<ClientSvmSigner> {
  let address: string;
  if (options?.solAddress) {
    address = options.solAddress;
  } else {
    const addrResult = await mcp.walletGetAddresses();
    const data = parseMcpToolResult<{ addresses?: Record<string, string> }>(addrResult);
    const sol = data?.addresses?.SOL;
    if (!sol) {
      throw new Error(
        "createQuickWalletSolanaSigner: no SOL address in wallet.get_addresses response",
      );
    }
    address = sol;
    console.error("createQuickWalletSolanaSigner address", address);
  }

  const { address: createAddress } = await import("@solana/addresses");
  const { signatureBytes: createSignatureBytes } = await import("@solana/keys");
  const { getTransactionEncoder } = await import("@solana/transactions");
  
  const solAddress = createAddress(address);
  
  const transactionEncoder = getTransactionEncoder();

  return {
    address: solAddress,
    signTransactions: async (transactions, config) => {
      void config;
      console.error("[quick-wallet-solana]signTransactions transactions", transactions);
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        const transactionBase58 = getBase58EncodedWireTransaction(transaction, transactionEncoder);
        console.error("[quick-wallet-solana] 交易 Base58 长度:", transactionBase58.length);

        const result = await mcp.walletSignTransaction("SOL", {
          raw_tx: transactionBase58
        });
        
        if (!result || typeof result !== "object" || !("content" in result)) {
          throw new Error("签名失败：未返回有效结果");
        }
        
        const content = (result as { content?: unknown[] }).content;
        const firstItem = Array.isArray(content)
          ? (content[0] as { type?: string; text?: string } | undefined)
          : undefined;
        
        if (!firstItem || firstItem.type !== "text" || typeof firstItem.text !== "string") {
          throw new Error("签名失败：返回格式无效");
        }
        
        let data: unknown;
        try {
          data = JSON.parse(firstItem.text);
        } catch {
          throw new Error("签名失败：返回数据不是有效的 JSON");
        }
        
        if (!data || typeof data !== "object") {
          throw new Error("签名失败：返回数据不是有效的对象");
        }
        
        const signatureInfo = extractQuickWalletSolanaSignature(data as Record<string, unknown>);
        
        if (!signatureInfo) {
          throw new Error("签名失败：无法从返回数据中提取签名");
        }
        
        console.error("[quick-wallet-solana] 签名提取成功:", signatureInfo.signatureBase58);
        
        const signatureBytesArray = base58.decode(signatureInfo.signatureBase58);
        const signature = createSignatureBytes(signatureBytesArray);
        
        const signatureDictionary = {
          [solAddress]: signature,
        };
        
        signatureDictionaries.push(signatureDictionary);
      }
      
      return signatureDictionaries;
    },
  } as ClientSvmSigner;
}
