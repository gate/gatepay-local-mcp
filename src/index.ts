#!/usr/bin/env node
/**
 * x402 stdio bridge with pluggable sign_mode support.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { LocalPrivateKeyMode } from "./modes/local-private-key.js";
import { PluginWalletMode } from "./modes/plugin-wallet.js";
import { createSignModeRegistry } from "./modes/registry.js";
import { QuickWalletMode } from "./modes/quick-wallet.js";
import {
  getPublicTools,
  handlePlaceOrder,
  handleSignPayment,
  handleCreateSignature,
  handleSubmitPayment,
  handleGatePayAuth,
  handleQuickWalletAuth,
  handleX402Request,
  handleCentralizedPayment,
} from "./tools/index.js";
import { createErrorResponse } from "./utils/response-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return startDir;
    dir = parent;
  }
}

const packageRoot = findPackageRoot(__dirname);
config({ path: join(packageRoot, ".env") });

async function main(): Promise<void> {
  const quickWalletMcpUrl = process.env.QUICK_WALLET_SERVER_URL ?? "https://api.gatemcp.ai/mcp/dex";
  const quickWalletApiKey = process.env.QUICK_WALLET_API_KEY;
  
  const pluginWalletBaseUrl = process.env.PLUGIN_WALLET_SERVER_URL ?? "https://walletmcp.gate.com/mcp";
  const pluginWalletToken = process.env.PLUGIN_WALLET_TOKEN;
  const pluginWalletServerUrl = pluginWalletToken 
    ? `${pluginWalletBaseUrl}?token=${encodeURIComponent(pluginWalletToken)}`
    : undefined;

  const signModeRegistry = createSignModeRegistry([
    new LocalPrivateKeyMode(),
    new QuickWalletMode({ mcpWalletUrl: quickWalletMcpUrl, mcpApiKey: quickWalletApiKey }),
    new PluginWalletMode({ serverUrl: pluginWalletServerUrl }),
  ]);

  const server = new Server({
    name: "x402 Paid Request Bridge (standalone)",
    version: "1.0.0",
  });
  server.registerCapabilities({ tools: { listChanged: false } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: getPublicTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "x402_place_order") {
      return await handlePlaceOrder(args ?? {});
    }

    if (name === "x402_sign_payment") {
      return await handleSignPayment(args ?? {}, signModeRegistry);
    }

    if (name === "x402_create_signature") {
      return await handleCreateSignature(args ?? {}, signModeRegistry);
    }

    if (name === "x402_submit_payment") {
      return await handleSubmitPayment(args ?? {});
    }

    if (name === "x402_gate_pay_auth") {
      return await handleGatePayAuth();
    }

    if (name === "x402_quick_wallet_auth") {
      return await handleQuickWalletAuth(args ?? {}, {
        mcpWalletUrl: quickWalletMcpUrl,
        mcpApiKey: quickWalletApiKey,
      });
    }

    if (name === "x402_centralized_payment") {
      return await handleCentralizedPayment(args ?? {});
    }

    // Keep x402_request handler for backward compatibility (not exposed in ListTools)
    if (name === "x402_request") {
      return await handleX402Request(args ?? {}, signModeRegistry);
    }

    return createErrorResponse(`未知工具: ${name}`);
  });

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
