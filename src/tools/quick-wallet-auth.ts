import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getMcpClient } from "../wallets/wallet-mcp-clients.js";
import {
  getQuickWalletAddressPayload,
  runQuickWalletDeviceAuthIfNeeded,
} from "../modes/quick-wallet.js";
import { createErrorResponse, createSuccessResponse } from "../utils/response-helpers.js";

export async function handleQuickWalletAuth(
  args: Record<string, unknown>,
  options: { mcpWalletUrl: string; mcpApiKey?: string },
): Promise<CallToolResult> {
  const walletLoginProvider: "google" | "gate" =
    String(args.wallet_login_provider ?? "gate").toLowerCase() === "google"
      ? "google"
      : "gate";

  try {
    const mcp = await getMcpClient({
      serverUrl: options.mcpWalletUrl,
      apiKey: options.mcpApiKey,
    });

    const phase = await runQuickWalletDeviceAuthIfNeeded(
      mcp,
      options.mcpWalletUrl,
      { walletLoginProvider },
    );

    const addresses = await getQuickWalletAddressPayload(mcp);

    if (phase === "login_succeeded") {
      return createSuccessResponse(
        [
          "quick_wallet 登录成功。",
          `钱包地址信息：${JSON.stringify(addresses, null, 2)}`
        ].join("\n"),
      );
    }

    return createSuccessResponse(
      JSON.stringify(
        {
          status: "ready",
          summary: "quick_wallet 进程内已有有效 MCP 登录态。",
          wallet_addresses: addresses,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResponse(message);
  }
}
