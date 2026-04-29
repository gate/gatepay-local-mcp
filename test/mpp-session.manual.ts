/**
 * 一键跑通 MPP session：init → fetch（循环 3 次）→ [可选链上 requestClose] → close
 *
 * 依赖：
 * - EVM_PRIVATE_KEY（或 PRIVATE_KEY）
 * - 本地服务已监听（默认 http://localhost:8080/api/image/generate）
 *
 * 可选环境变量：
 * - MPP_SESSION_TEST_URL — 完整 URL，默认 http://localhost:8080/api/image/generate
 * - MPP_SESSION_TEST_BODY — POST 体（合法 JSON 字符串），默认 {"prompt":"mpp-session-manual-test"}
 * - GATE_PAY_ENV、MPP_BASE_CHAIN_ID、MPP_BASE_ESCROW_CONTRACT 等同 mpp-session 工具
 * - MPP_SESSION_TEST_REQUEST_CLOSE=1 时，在 close 之前调用 handleMppRequestClose（会发测试网链上交易）
 *
 * 运行：npm run test:mpp-session
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  handleMppCloseSession,
  handleMppFetch,
  handleMppInitSession,
  handleMppRequestClose,
  handleMppWithdraw,
} from "../src/tools/mpp-session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
config({ path: join(packageRoot, ".env") });

const DEFAULT_URL = "http://dev.halftrust.xyz/pay-merchant-demo/api/image/generate";
const DEFAULT_BODY = JSON.stringify({ prompt: "mpp-session-manual-test" });
const FETCH_ROUNDS = 3;

function printToolResult(label: string, result: CallToolResult): boolean {
  const text =
    result.content[0]?.type === "text" ? result.content[0].text : JSON.stringify(result.content);
  console.log(`\n--- ${label} ---`);
  console.log(text);
  if (result.isError) {
    console.error(`[${label}] isError=true`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  process.env.GATE_PAY_ENV = "test";
  const url =
    process.env.MPP_SESSION_TEST_URL?.trim() || DEFAULT_URL;
  const body =
    process.env.MPP_SESSION_TEST_BODY?.trim() || DEFAULT_BODY;

  let ok = true;

  ok = printToolResult(
    "handleMppInitSession",
    await handleMppInitSession({
      max_deposit: "1",
      //sign_mode: "plugin_wallet",  // local_private_key, quick_wallet, plugin_wallet
      decimals: 6,
    }),
  );
  if (!ok) process.exit(1);

  for (let i = 1; i <= FETCH_ROUNDS; i++) {
    ok = printToolResult(
      `handleMppFetch (#${i}/${FETCH_ROUNDS})`,
      await handleMppFetch({
        url,
        method: "POST",
        body,
      }),
    );
    if (!ok) process.exit(1);
  }

  // ----------- requestClose -----------
  // ok = printToolResult(
  //   "handleMppRequestClose",
  //   await handleMppRequestClose({}),
  // );
  // if (!ok) process.exit(1);


  // // ----------- withdraw -----------
  // ok = printToolResult(
  //   "handleMppWithdraw",
  //   await handleMppWithdraw({}),
  // );
  // if (!ok) process.exit(1);


  // ----------- close -----------
  ok = printToolResult(
    "handleMppCloseSession",
    await handleMppCloseSession({}),
  );
  if (!ok) process.exit(1);

  console.log("\n全部步骤完成。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
