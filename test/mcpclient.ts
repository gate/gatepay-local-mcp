/**
 * MCP 客户端示例：连接远程 MCP 服务并列出所有工具及其介绍
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://walletmcp.gate.com/mcp?token=HqVNjKcAuEPjxCJsAuuzh";

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  const client = new Client(
    {
      name: "mcp-list-tools-client",
      version: "1.0.0",
    },
    {}
  );

  await client.connect(transport);

  const { tools } = await client.listTools();

  console.log(`\n共 ${tools.length} 个工具:\n`);
  console.log("─".repeat(60));

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    console.log(`\n[${i + 1}] ${tool.name}`);
    console.log(`    描述: ${tool.description ?? "(无)"}`);
    if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
      console.log("    参数:");
      const props = tool.inputSchema.properties as Record<string, { description?: string; type?: string }>;
      for (const [key, schema] of Object.entries(props)) {
        const desc = schema.description ? ` — ${schema.description}` : "";
        const type = schema.type ?? "";
        console.log(`      - ${key} (${type})${desc}`);
      }
    }
    console.log("");
  }

  console.log("─".repeat(60));
  await transport.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
