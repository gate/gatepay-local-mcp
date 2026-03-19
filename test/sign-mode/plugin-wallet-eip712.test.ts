import test from "node:test";
import assert from "node:assert/strict";
import { createPluginWalletSigner } from "../../src/modes/signers.js";
import type { PluginWalletClient } from "../../src/wallets/plugin-wallet-client.js";

test("plugin wallet generates complete EIP-712 JSON with EIP712Domain", async () => {
  let capturedTypedDataJson = "";
  
  // Mock plugin wallet client 用来捕获传入的 JSON
  const mockClient: PluginWalletClient = {
    async walletStatus() {
      return { content: [{ type: "text", text: JSON.stringify({ connected: true }) }] };
    },
    async connectWallet() {
      return { content: [{ type: "text", text: JSON.stringify({ accounts: ["0x1234"] }) }] };
    },
    async getAccounts() {
      return { content: [{ type: "text", text: JSON.stringify({ accounts: ["0x1234"] }) }] };
    },
    async signMessage() {
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify({ signature: "0xaabbcc" + "0".repeat(124) }) 
        }] 
      };
    },
    async signTypedData(typedDataJson: string) {
      capturedTypedDataJson = typedDataJson; // 捕获传入的 JSON
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify({ signature: "0xaabbcc" + "0".repeat(124) }) 
        }] 
      };
    },
  };

  const signer = createPluginWalletSigner(mockClient, "0x1234567890123456789012345678901234567890");

  // 模拟来自 ExactEvmScheme 的 signTypedData 调用
  const typedDataMsg = {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 1,
      verifyingContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: "0xD7AB08b0e0bc5907AeDf3F5ac908c511Effe109E",
      to: "0xEDBFCbdf2846eE8e1ceC56935973d16348cd8042",
      value: "200",
      validAfter: "1773891245",
      validBefore: "1773892444",
      nonce: "0x0811d24160b1847f99368e81b5e39c2acec667e073123bb79edfc3d0791acff3",
    },
  };

  await signer.signTypedData(typedDataMsg);

  console.log("Generated JSON for plugin wallet:");
  console.log(capturedTypedDataJson);

  // 解析并验证 JSON 结构
  const parsed = JSON.parse(capturedTypedDataJson);
  
  // 验证包含所有必需的顶级字段
  assert.ok(parsed.domain, "Should have domain field");
  assert.ok(parsed.types, "Should have types field");
  assert.ok(parsed.primaryType, "Should have primaryType field");  
  assert.ok(parsed.message, "Should have message field");

  // 验证 types 中包含了 EIP712Domain
  assert.ok(parsed.types.EIP712Domain, "types should include EIP712Domain");
  assert.ok(parsed.types.TransferWithAuthorization, "types should include TransferWithAuthorization");

  // 验证 EIP712Domain 的结构
  const eip712Domain = parsed.types.EIP712Domain;
  const expectedFields = ["name", "version", "chainId", "verifyingContract"];
  
  assert.equal(eip712Domain.length, 4, "EIP712Domain should have 4 fields");
  
  expectedFields.forEach(fieldName => {
    const field = eip712Domain.find((f: any) => f.name === fieldName);
    assert.ok(field, `EIP712Domain should include field: ${fieldName}`);
  });

  // 验证 domain 内容
  assert.equal(parsed.domain.name, "USD Coin");
  assert.equal(parsed.domain.version, "2");
  assert.equal(parsed.domain.chainId, 1);
  assert.equal(parsed.domain.verifyingContract, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

  // 验证 message 内容
  assert.equal(parsed.message.from, "0xD7AB08b0e0bc5907AeDf3F5ac908c511Effe109E");
  assert.equal(parsed.message.value, "200");

  console.log("✅ Generated JSON contains all required EIP-712 fields including EIP712Domain");
});