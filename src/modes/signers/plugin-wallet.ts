import { getBase64EncodedWireTransaction } from "@solana/kit";
import { base58 } from "@scure/base";
import type { ClientEvmSigner, ClientSvmSigner } from "../../x402/types.js";
import type { PluginWalletClient } from "../../wallets/plugin-wallet-client.js";
import {
  parseMcpToolResult,
  serializeTypedDataForMcp,
  extractSignatureFromMcpResult,
  extractSolanaSignature,
  extractPluginWalletSignatures,
} from "./shared-utils.js";

/**
 * 创建插件钱包 Signer (用于 plugin_wallet 签名模式)
 */
export function createPluginWalletSigner(
  client: PluginWalletClient,
  address: `0x${string}`,
): ClientEvmSigner {
  const signDigest = async (digest: `0x${string}`): Promise<`0x${string}`> => {
    const result = await client.signMessage(digest, address);
    const data = parseMcpToolResult<Record<string, unknown>>(result);

    const sig = data && extractSignatureFromMcpResult(data);
    if (!sig) {
      throw new Error(
        "签名失败：未返回有效签名。请确保浏览器钱包已连接并正常工作。",
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
    if (msg.domain.chainId) {
      const chainId = typeof msg.domain.chainId === 'number' 
        ? `0x${msg.domain.chainId.toString(16)}`
        : String(msg.domain.chainId);
      
      const switchChainResult = await client.switchChain(chainId);
      const switchChainData = parseMcpToolResult<Record<string, unknown>>(switchChainResult);
      if (!switchChainData) {
        throw new Error(
          "切换链失败：未返回有效结果。请确保浏览器钱包已连接并正常工作。",
        );
      }
    }

    const completeTypes = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...msg.types,
    };

    const typedDataJson = serializeTypedDataForMcp({
      domain: msg.domain,
      types: completeTypes,
      primaryType: msg.primaryType,
      message: msg.message,
    });
    console.error("[createPluginWalletSigner] calling signTypedData with:", typedDataJson);
    const result = await client.signTypedData(typedDataJson, address);
    console.error("[createPluginWalletSigner] signTypedData result:", JSON.stringify(result));
    const data = parseMcpToolResult<Record<string, unknown>>(result);
    console.error("[createPluginWalletSigner] parsed data:", JSON.stringify(data));

    const sig = data && extractSignatureFromMcpResult(data);
    console.error("[createPluginWalletSigner] extracted sig:", sig);
    if (!sig) {
      throw new Error(
        "签名失败：未返回有效签名。请确保浏览器钱包已连接并正常工作。",
      );
    }
    return sig;
  };

  return {
    address,
    signTypedData,
    signDigest,
  };
}

export const createSignerFromPluginWallet = createPluginWalletSigner;

/**
 * 创建插件钱包 Solana Signer (用于 plugin_wallet 签名模式的 Solana 网络)
 */
export async function createPluginWalletSolanaSigner(
  client: PluginWalletClient,
  publicKeyBase58: string,
): Promise<ClientSvmSigner> {
  const { address: createAddress } = await import("@solana/addresses");
  const { signatureBytes: createSignatureBytes } = await import("@solana/keys");
  
  const address = createAddress(publicKeyBase58);
  console.error("publicKeyBase58", publicKeyBase58);
  console.error("address", address);

  return {
    address,
    signTransactions: async (transactions, config) => {
      void config;
      
      const signatureDictionaries = [];
      
      for (const transaction of transactions) {
        const transactionBase64 = getBase64EncodedWireTransaction(transaction);

        const result = await client.solSignTransaction(transactionBase64);
        const data = parseMcpToolResult<Record<string, unknown>>(result);
        
        if (!data) {
          throw new Error("签名失败：未返回有效结果");
        }
        
        console.error("[PluginWallet-Solana] 钱包返回数据:", JSON.stringify(data, null, 2));
        
        const multiSigResult = extractPluginWalletSignatures(data);
        
        if (multiSigResult && multiSigResult.signatures.length > 0) {
          console.error(`[PluginWallet-Solana] 检测到多签交易，插件钱包签了 ${multiSigResult.signatures.length} 个签名`);
          
          const walletSignature = multiSigResult.signatures[0];
          
          console.error(`[PluginWallet-Solana] 使用插件钱包签名 - 槽位 ${walletSignature.index}: ${walletSignature.signature.slice(0, 20)}...`);
          
          const signatureBytesArray = base58.decode(walletSignature.signature);
          const signature = createSignatureBytes(signatureBytesArray);
          
          const signatureDictionary = {
            [address]: signature,
          };
          
          signatureDictionaries.push(signatureDictionary);
        } else {
          console.error("[PluginWallet-Solana] 未检测到多签格式，使用单签提取方法");
          
          const signatureBase58 = extractSolanaSignature(data);
          if (!signatureBase58) {
            throw new Error("签名失败：未返回有效签名");
          }
          
          const signatureBytesArray = base58.decode(signatureBase58);
          const signature = createSignatureBytes(signatureBytesArray);
          
          const signatureDictionary = {
            [address]: signature,
          };
          
          signatureDictionaries.push(signatureDictionary);
        }
      }
      
      return signatureDictionaries;
    },
  };
}
