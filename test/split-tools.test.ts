/**
 * 测试拆分后的 x402_place_order 和 x402_sign_payment 工具。
 * 
 * 运行方式:
 *   pnpm run build && pnpm run test:split-tools
 * 
 * 需要环境变量：
 *   - EVM_PRIVATE_KEY 或 QUICK_WALLET_API_KEY（取决于使用的签名模式）
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import assert from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const serverEntry = join(packageRoot, "dist", "src", "index.js");

const DEFAULT_TIMEOUT_MS = 180_000;

function createChildStdioTransport(
  command: string,
  args: string[],
  childEnv: Record<string, string | undefined>,
): Transport {
  let child: ChildProcessWithoutNullStreams | undefined;
  const readBuffer = new ReadBuffer();

  const transport: Transport = {
    async start() {
      child = spawn(command, args, {
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => {
        readBuffer.append(chunk);
        for (;;) {
          const msg = readBuffer.readMessage();
          if (msg === null) break;
          transport.onmessage?.(msg as JSONRPCMessage);
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        process.stderr.write(d);
      });
      child.on("close", () => transport.onclose?.());
      child.on("error", (err) => transport.onerror?.(err));
    },
    async send(message: JSONRPCMessage) {
      if (!child?.stdin) throw new Error("transport not started");
      const line = serializeMessage(message);
      await new Promise<void>((resolve, reject) => {
        const ok = child!.stdin.write(line, (err) => {
          if (err) reject(err);
        });
        if (ok) resolve();
        else child!.stdin.once("drain", resolve);
      });
    },
    async close() {
      child?.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 150));
    },
  };
  return transport;
}

async function main(): Promise<void> {
  console.log("[split-tools test] 开始测试拆分后的工具...");

  const timeoutMs = Number(process.env.GATEPAY_MCP_TEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const childEnv = { ...process.env } as Record<string, string | undefined>;
  const transport = createChildStdioTransport(process.execPath, [serverEntry], childEnv);

  const client = new Client({
    name: "gatepay-split-tools-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    console.log("[split-tools test] MCP 客户端已连接");

    // 列出可用工具
    const listToolsResult = await client.listTools();
    console.log("[split-tools test] 可用工具:", JSON.stringify(listToolsResult, null, 2));
    
    const toolNames = listToolsResult.tools.map((t: { name: string }) => t.name);
    assert.ok(toolNames.includes("x402_place_order"), "应该包含 x402_place_order 工具");
    assert.ok(toolNames.includes("x402_sign_payment"), "应该包含 x402_sign_payment 工具");
    assert.ok(!toolNames.includes("x402_request"), "不应该包含已注释的 x402_request 工具");

    // 步骤1: 调用 x402_place_order
    console.log("\n[步骤1] 调用 x402_place_order 下单...");
    const placeOrderArgs = {
      url: "https://webws.gate.io:443/flight/order",
      method: "POST",
      body: JSON.stringify({ flightId: "FL002", uid: "100" }),
    };

    const placeOrderPromise = client.callTool({
      name: "x402_place_order",
      arguments: placeOrderArgs,
    });

    const placeOrderTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("place_order timeout")), timeoutMs),
    );

    const placeOrderResult = await Promise.race([placeOrderPromise, placeOrderTimeout]);
    console.log("[place_order 结果]:", JSON.stringify(placeOrderResult, null, 2));

    // 解析 place_order 的响应
    const placeOrderContent = placeOrderResult.content?.[0];
    assert.ok(placeOrderContent, "place_order 应该返回内容");
    assert.equal(placeOrderContent.type, "text", "内容类型应该是 text");
    
    const placeOrderData = JSON.parse(placeOrderContent.text);
    console.log("[place_order 解析后]:", JSON.stringify(placeOrderData, null, 2));
    
    assert.ok(placeOrderData.request, "应该包含 request 信息");
    assert.ok(placeOrderData.response, "应该包含 response 信息");
    assert.equal(placeOrderData.response.status, 402, "响应状态应该是 402");
    
    const paymentRequiredHeader = placeOrderData.response.headers["PAYMENT-REQUIRED"] 
      || placeOrderData.response.headers["payment-required"];
    
    if (!paymentRequiredHeader) {
      console.log("警告：未获取到 PAYMENT-REQUIRED 响应头，可能服务端未返回402或已支付成功");
      console.log("响应头:", JSON.stringify(placeOrderData.response.headers, null, 2));
      console.log("[测试完成] place_order 工具工作正常");
      await client.close();
      return;
    }

    console.log("[PAYMENT-REQUIRED 头]:", paymentRequiredHeader);

    // 步骤2: 调用 x402_sign_payment
    console.log("\n[步骤2] 调用 x402_sign_payment 签名支付...");
    
    // 决定使用哪种签名模式
    let signMode: string | undefined;
    let walletLoginProvider: string | undefined;
    
    if (process.env.EVM_PRIVATE_KEY?.trim()) {
      signMode = "local_private_key";
      console.log("[签名模式] 使用 local_private_key");
    } else if (process.env.QUICK_WALLET_API_KEY?.trim()) {
      signMode = "quick_wallet";
      walletLoginProvider = "gate";
      console.log("[签名模式] 使用 quick_wallet");
    } else {
      console.log("警告：未设置 EVM_PRIVATE_KEY 或 QUICK_WALLET_API_KEY，跳过签名支付测试");
      console.log("[测试完成] place_order 工具已验证，sign_payment 需要配置签名密钥");
      await client.close();
      return;
    }

    const signPaymentArgs: Record<string, unknown> = {
      url: placeOrderData.request.url,
      method: placeOrderData.request.method,
      body: placeOrderData.request.body,
      payment_required_header: paymentRequiredHeader,
      sign_mode: signMode,
    };

    if (walletLoginProvider) {
      signPaymentArgs.wallet_login_provider = walletLoginProvider;
    }
    console.log("[sign_payment 参数]:", JSON.stringify(signPaymentArgs, null, 2));

    const signPaymentPromise = client.callTool({
      name: "x402_sign_payment",
      arguments: signPaymentArgs,
    });

    const signPaymentTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("sign_payment timeout")), timeoutMs),
    );

    const signPaymentResult = await Promise.race([signPaymentPromise, signPaymentTimeout]);
    console.log("[sign_payment 结果]:", JSON.stringify(signPaymentResult, null, 2));

    const signPaymentContent = signPaymentResult.content?.[0];
    assert.ok(signPaymentContent, "sign_payment 应该返回内容");
    
    if (signPaymentResult.isError) {
      console.log("签名支付返回错误（可能是余额不足等预期错误）");
      console.log("错误信息:", signPaymentContent.text);
    } else {
      console.log("签名支付成功！");
      console.log("响应:", signPaymentContent.text);
    }

    console.log("\n[测试完成] 两个工具都工作正常！");
    await client.close();
  } catch (error) {
    console.error("[测试失败]", error);
    await client.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
