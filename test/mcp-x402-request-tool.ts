/**
 * 通过 MCP stdio 子进程调用 dist/src/index.js，模拟对 x402_request 的调用：
 * quick_wallet → 远程 MCP 钱包 → flight/order。
 *
 * 需 MCP_WALLET_API_KEY；建议已有 ~/.gate-pay/auth.json（否则设备码登录在非交互环境易超时）。
 *
 *   pnpm run build && MCP_WALLET_API_KEY=xxx pnpm run test:mcp-tool
 *
 * 可选：GATEPAY_MCP_TEST_TIMEOUT_MS（默认 180000）
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const serverEntry = join(packageRoot, "dist", "src", "index.js");

const TOOL_ARGS = {
  url: "https://webws.gate.io:443/flight/order",
  method: "POST",
  body: '{"flightId":"FL002","uid":"100"}',
  auth_mode: "quick_wallet",
  wallet_login_provider: "gate",
} as const;

const DEFAULT_TIMEOUT_MS = 180_000;

function createChildStdioTransport(
    command: string,
    args: string[],
    childEnv: NodeJS.ProcessEnv,
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
  if (!existsSync(serverEntry)) {
    console.error("请先执行: pnpm run build  （缺少 %s）", serverEntry);
    process.exit(1);
  }

  if (!process.env.MCP_WALLET_API_KEY?.trim()) {
    console.error("请设置 MCP_WALLET_API_KEY（远程 MCP 钱包服务）。");
    process.exit(1);
  }

  const timeoutMs = Number(process.env.GATEPAY_MCP_TEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const childEnv = { ...process.env } as NodeJS.ProcessEnv;
  const transport = createChildStdioTransport(process.execPath, [serverEntry], childEnv);

  const client = new Client({
    name: "gatepay-mcp-tool-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    const callPromise = client.callTool({
      name: "x402_request",
      arguments: { ...TOOL_ARGS },
    });
    const result = await Promise.race([
      callPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
              new Error(
                  `超过 ${timeoutMs}ms 未完成（无本地 token 时会卡在设备码登录，请先完成一次 Gate 授权或增大 GATEPAY_MCP_TEST_TIMEOUT_MS）`,
              ),
          );
        }, timeoutMs);
      }),
    ]);

    const contentBlocks = result.content as
        | Array<{ type?: string; text?: string }>
        | undefined;
    const text = contentBlocks?.find((c) => c.type === "text")?.text;
    if (!text) {
      console.error("无 text 内容:", result);
      process.exit(1);
    }

    console.log("--- x402_request 返回 ---\n", text);

    if (
        result.isError &&
        /EVM_PRIVATE_KEY|quick_wallet login|MCP_WALLET|API_KEY|token|未设置/i.test(text)
    ) {
      console.error("配置/登录类错误，未完成远程 MCP 链路:\n", text);
      process.exit(1);
    }
    let hint = "";
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (String(parsed.message ?? "").includes("insufficient")) {
        hint = "（业务侧提示余额不足，说明已走通支付与下单接口）";
      }
    } catch {
      /* 非 JSON 也允许 */
    }
    console.error("\n✓ 测试通过：已访问远程 MCP 并完成 x402_request。" + hint);
  } finally {
    await transport.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
