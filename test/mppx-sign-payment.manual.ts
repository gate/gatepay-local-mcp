/**
 * 本地手动调用 handleMppxSignPayment（不经 MCP）。
 *
 * 用法一：JSON 文件（推荐，便于贴长 WWW-Authenticate）
 *   pnpm run test:mppx-sign-manual -- ./path/to/args.json
 *
 * args.json 示例（字段与 MCP 工具一致）：
 *   {
 *     "url": "https://example.com/api/order",
 *     "method": "POST",
 *     "body": "{\"flightId\":\"FL001\"}",
 *     "www_authenticate_header": "Payment ...",
 *     "response_body": "",
 *     "mpp_tempo_max_deposit": "10"
 *   }
 *
 * 用法二：环境变量（可写在项目根 .env）
 *   EVM_PRIVATE_KEY=0x... \\
 *   MPP_SIGN_URL=https://... \\
 *   MPP_SIGN_METHOD=POST \\
 *   MPP_SIGN_BODY='{}' \\
 *   MPP_SIGN_WWW_AUTHENTICATE='Payment ...' \\
 *   pnpm run test:mppx-sign-manual
 *
 * 长 header 可放文件：
 *   MPP_SIGN_WWW_AUTHENTICATE_FILE=/tmp/www-auth.txt
 *
 * 可选：MPP_SIGN_RESPONSE_BODY — 与 402 响应 body 对齐（mppx 解析 challenge 主要靠 header）
 *
 * Tempo session（intent=session）自动开通道时需其一：
 *   MPP_SIGN_TEMPO_MAX_DEPOSIT=10
 *   或 MPP_SIGN_TEMPO_DEPOSIT=10
 * 或 JSON 里 mpp_tempo_max_deposit
 */
import { existsSync, readFileSync } from "node:fs";
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleMppxSignPayment } from "../src/tools/mppx-sign-payment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
config({ path: join(packageRoot, ".env") });

function loadArgsFromEnv(): Record<string, unknown> {
  const wwwFromFile = process.env.MPP_SIGN_WWW_AUTHENTICATE_FILE?.trim();
  const wwwAuthenticate =
    wwwFromFile && existsSync(wwwFromFile)
      ? readFileSync(wwwFromFile, "utf8").trim()
      : process.env.MPP_SIGN_WWW_AUTHENTICATE?.trim();

  const out: Record<string, unknown> = {};
  const url = process.env.MPP_SIGN_URL?.trim();
  if (url) out.url = url;
  const method = process.env.MPP_SIGN_METHOD?.trim();
  if (method) out.method = method;
  if (process.env.MPP_SIGN_BODY !== undefined) {
    out.body = process.env.MPP_SIGN_BODY;
  }
  if (wwwAuthenticate) out.www_authenticate_header = wwwAuthenticate;
  if (process.env.MPP_SIGN_RESPONSE_BODY !== undefined) {
    out.response_body = process.env.MPP_SIGN_RESPONSE_BODY;
  }
  const maxDep = process.env.MPP_SIGN_TEMPO_MAX_DEPOSIT?.trim() ?? process.env.MPP_TEMPO_MAX_DEPOSIT?.trim();
  if (maxDep) out.mpp_tempo_max_deposit = maxDep;
  const sessCtx = process.env.MPP_SIGN_SESSION_CONTEXT?.trim();
  if (sessCtx) out.mpp_session_context = sessCtx;
  return out;
}

function loadArgs(): Record<string, unknown> {
  const jsonPath = process.argv[2]?.trim();
  if (jsonPath) {
    const resolved = jsonPath.startsWith("/") ? jsonPath : join(process.cwd(), jsonPath);
    if (!existsSync(resolved)) {
      console.error(`找不到参数文件: ${resolved}`);
      process.exit(1);
    }
    const raw = readFileSync(resolved, "utf8");
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      console.error("JSON 解析失败:", e);
      process.exit(1);
    }
  }
  return loadArgsFromEnv();
}

function printUsage(): void {
  console.error(`
用法:
  pnpm run test:mppx-sign-manual -- <args.json>

或设置环境变量后:
  pnpm run test:mppx-sign-manual

需要 EVM_PRIVATE_KEY（或 PRIVATE_KEY），与 handleMppxSignPayment 一致。
`);
}

async function main(): Promise<void> {
  const url = "http://localhost:8080/api/image/generate?quality=high";
  const firstResp = await fetch(url);
  const args = {
    url: url,
    method: "GET",
    body: "",
    www_authenticate_header: firstResp.headers.get("WWW-Authenticate") as string,
    response_body: firstResp.body,
    mpp_tempo_max_deposit: "10",
  }

  if (!args.url) {
    printUsage();
    console.error("错误: 未提供 url（JSON 里写 url，或设置 MPP_SIGN_URL）。");
    process.exit(1);
  }

  console.log("调用参数（敏感字段已省略长度）:\n", {
    ...args,
    www_authenticate_header:
      typeof args.www_authenticate_header === "string"
        ? `(string, ${(args.www_authenticate_header as string).length} chars)`
        : args.www_authenticate_header,
    body:
      typeof args.body === "string" && args.body.length > 200
        ? args.body.slice(0, 200) + "…"
        : args.body,
  });

  const result = await handleMppxSignPayment(args);
  console.log("result", result);
  const text = result.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");

  if (result.isError) {
    console.error("--- isError ---\n", text);
    process.exit(1);
  }

  console.log("--- 结果 ---\n", text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
