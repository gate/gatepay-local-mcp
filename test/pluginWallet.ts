/**
 * 示例：调用 MCP 工具 dex_wallet_sign_transaction
 * 使用随便编的测试数据，实际会因未登录/无效数据返回错误，仅演示调用方式
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://walletmcp.gate.com/mcp?token=HqVNjKcAuEPjxCJsAuuzh";

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client(
    { name: "call-sign-tx-client", version: "1.0.0" },
    {}
  );

  await client.connect(transport);

  // 调用 dex_wallet_sign_transaction，参数随便编的
  const result = await client.callTool({
    name: "connect_wallet",
    arguments: {
    },
  });

  console.log("调用结果:", JSON.stringify(result, null, 2));

  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item) {
      console.log("\n服务端返回:", item.text);
    }
  }

  await transport.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
