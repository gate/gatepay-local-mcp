import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://walletmcp-test.gateweb3.cc/mcp?token=Z_GWbn9TMAnWBH0Fj3M73";

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client(
    { name: "call-sign-message-client", version: "1.0.0" },
    {}
  );

  await client.connect(transport);

  const connectResult = await client.callTool({
    name: "connect_wallet",
    arguments: {},
  });

  const connectText =
    Array.isArray(connectResult.content) &&
    connectResult.content[0] &&
    "text" in connectResult.content[0]
      ? connectResult.content[0].text
      : "";

  console.log("connectText", connectText);
  const connectData = JSON.parse(connectText);
  const address = connectData.accounts?.[0];


  

  const signResult = await client.callTool({
    name: "sign_message",
    arguments: {
      message: "hello gatepay",
      address,
    },
  });

  console.log("签名结果:", JSON.stringify(signResult, null, 2));

  await transport.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});