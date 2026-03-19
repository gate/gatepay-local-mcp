import test from "node:test";
import assert from "node:assert/strict";

import { PluginWalletMode } from "../../src/modes/plugin-wallet.js";
import type { PluginWalletClient } from "../../src/wallets/plugin-wallet-client.js";

const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";
const TEST_SIGNATURE =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1b";
const TEST_DIGEST = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function createStubClient(overrides: Partial<PluginWalletClient> = {}): PluginWalletClient {
  return {
    async walletStatus() {
      return {
        content: [{ type: "text", text: JSON.stringify({ connected: false }) }],
      };
    },
    async connectWallet() {
      return {
        content: [{ type: "text", text: JSON.stringify({ accounts: [TEST_ADDRESS] }) }],
      };
    },
    async getAccounts() {
      return {
        content: [{ type: "text", text: JSON.stringify({ accounts: [TEST_ADDRESS] }) }],
      };
    },
    async signMessage() {
      return {
        content: [{ type: "text", text: JSON.stringify({ signature: TEST_SIGNATURE }) }],
      };
    },
    async signTypedData() {
      return {
        content: [{ type: "text", text: JSON.stringify({ signature: TEST_SIGNATURE }) }],
      };
    },
    ...overrides,
  };
}

test("reports plugin_wallet as not_configured when no plugin wallet URL is provided", async () => {
  const mode = new PluginWalletMode({
    serverUrl: "",
    clientFactory: async () => createStubClient(),
  });

  const availability = await mode.checkAvailability();

  assert.deepEqual(availability, {
    status: "not_configured",
    summary: "plugin_wallet 未配置 PLUGIN_WALLET_URL。",
    missing: ["PLUGIN_WALLET_URL"],
  });
});

test("reports plugin_wallet as ready when the browser wallet is already connected", async () => {
  const mode = new PluginWalletMode({
    serverUrl: "https://plugin-wallet.test/mcp",
    clientFactory: async () =>
      createStubClient({
        async walletStatus() {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ connected: true, accounts: [TEST_ADDRESS] }),
              },
            ],
          };
        },
      }),
  });

  const availability = await mode.checkAvailability();

  assert.deepEqual(availability, {
    status: "ready",
    summary: "plugin_wallet 已连接可用浏览器钱包。",
  });
});

test("reports plugin_wallet as needs_login when the browser wallet is not connected", async () => {
  const mode = new PluginWalletMode({
    serverUrl: "https://plugin-wallet.test/mcp",
    clientFactory: async () => createStubClient(),
  });

  const availability = await mode.checkAvailability();

  assert.deepEqual(availability, {
    status: "needs_login",
    summary: "plugin_wallet 需要先连接浏览器钱包。",
    missing: ["browser_wallet_connection"],
  });
});

test("connects the plugin wallet and signs digests with sign_message", async () => {
  const calls: Array<{ tool: string; args?: { address?: string; message?: string } }> = [];
  const mode = new PluginWalletMode({
    serverUrl: "https://plugin-wallet.test/mcp",
    clientFactory: async () =>
      createStubClient({
        async connectWallet() {
          calls.push({ tool: "connect_wallet" });
          return {
            content: [{ type: "text", text: JSON.stringify({ accounts: [TEST_ADDRESS] }) }],
          };
        },
        async signMessage(message, address) {
          calls.push({ tool: "sign_message", args: { message, address } });
          return {
            content: [{ type: "text", text: JSON.stringify({ signature: TEST_SIGNATURE }) }],
          };
        },
      }),
  });

  const session = await mode.resolveSigner({ walletLoginProvider: "gate" });
  const signature = await session.signer.signDigest?.(TEST_DIGEST);

  assert.equal(session.signer.address, TEST_ADDRESS);
  assert.equal(signature, TEST_SIGNATURE);
  assert.deepEqual(calls, [
    { tool: "connect_wallet" },
    {
      tool: "sign_message",
      args: {
        address: TEST_ADDRESS,
        message: TEST_DIGEST,
      },
    },
  ]);
});

test("falls back to get_accounts when connect_wallet does not return an address", async () => {
  const mode = new PluginWalletMode({
    serverUrl: "https://plugin-wallet.test/mcp",
    clientFactory: async () =>
      createStubClient({
        async connectWallet() {
          return {
            content: [{ type: "text", text: JSON.stringify({ connected: true }) }],
          };
        },
      }),
  });

  const session = await mode.resolveSigner({ walletLoginProvider: "gate" });

  assert.equal(session.signer.address, TEST_ADDRESS);
});
