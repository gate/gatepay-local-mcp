import https from "https";
import http from "http";
import { URL } from "url";
import { randomFillSync } from "crypto";

import { getEnvConfig } from "../../config/env-config.js";
import { SOURCE_AI_AGENT } from "./body.js";
import { printCurlReplayToStderr } from "./curl_cmd.js";
import { parseCheckInResponseBody, resultFromEnvelope, SuccessOut } from "./response.js";
import { apiSignPreimage, apiSignFromPreimage, encodePathAndQuery } from "./sign.js";

// ---------- 常量 ----------

const CONTENT_TYPE_JSON = "application/json; charset=utf-8";
const CHECKIN_PATH = "/api/v1/tx/checkin";

// ---------- 入参类型 ----------

export interface CheckInParams {
  /** 裸 token 或带 Bearer 前缀均可，内部统一处理 */
  mcpToken: string;
  walletAddress: string;
  chain: string;
  /** chain_category，e.g. "evm" / "utxo" / "sol" */
  chainCategory: string;
  /** 签消息时的明文内容，与 intent / txBundle 三选一 */
  message?: string;
  /** intent 对象，与 message / txBundle 互斥；传对象或 JSON 字符串均可 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intent?: Record<string, any> | string;
  /** txBundle JSON 字符串（来自 dex_tx_transfer_preview），与 message / intent 互斥 */
  txBundle?: string;
  /** 可选 type，e.g. "limit_price_order" */
  type?: string;
  /** 可选，覆盖默认 gateway base URL */
  gatewayBaseURL?: string;
  /** 打印签名原文到 stderr（调试用） */
  verbose?: boolean;
}

// ---------- 内部工具函数 ----------

function stripBearerPrefix(s: string): string {
  const t = s.trim();
  if (t.toLowerCase().startsWith("bearer ")) return t.slice(7).trim();
  return t;
}

function randomAPICode(): number {
  const buf = Buffer.allocUnsafe(4);
  randomFillSync(buf);
  const n = buf.readUInt32BE(0);
  const code = n % (1 << 31);
  return code <= 0 ? 1 : code;
}

function buildHeaders(
  method: string,
  apiSign: string,
  ts: number,
  apiCode: number,
  rawToken: string
): Record<string, string> {
  const h: Record<string, string> = {
    "api-sign": apiSign,
    "api-timestamp": String(ts),
    "api-code": String(apiCode),
    Authorization: `Bearer ${rawToken}`,
  };
  if (method === "POST") h["Content-Type"] = CONTENT_TYPE_JSON;
  return h;
}

function doRequest(
  method: string,
  fullURL: string,
  headers: Record<string, string>,
  body: string
): Promise<{
  statusCode: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const u = new URL(fullURL);
    const options: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers,
    };
    const transport = u.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          statusCode: res.statusCode ?? 0,
          statusText: `${res.statusCode} ${res.statusMessage}`,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body) req.write(body, "utf8");
    req.end();
  });
}

function buildBody(params: CheckInParams): string {
  const { walletAddress, chain, chainCategory, message, intent, txBundle, type } = params;

  // 互斥校验
  const picks = [message, intent, txBundle].filter((v) => v !== undefined && v !== "").length;
  if (picks > 1) throw new Error("message、intent、txBundle 三者互斥，只能传一个");
  if (picks === 0) throw new Error("message、intent、txBundle 至少传一个");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    wallet_address: walletAddress,
    chain,
    chain_category: chainCategory,
    source: SOURCE_AI_AGENT,
  };

  if (type) body.type = type;

  if (message !== undefined && message !== "") {
    body.message = message;
  } else if (txBundle !== undefined && txBundle !== "") {
    // txBundle 直接作为 message 字段（compact JSON 字符串）
    body.message = txBundle;
  } else if (intent !== undefined) {
    // intent 是字符串时直接透传（服务端期望 JSON string），对象时先序列化
    body.intent =
      typeof intent === "string" ? intent : JSON.stringify(intent);
  }

  return JSON.stringify(body);
}

// ---------- 核心导出方法 ----------

/**
 * txCheckin: 执行一次 tx check-in，返回 checkin_token 等结果。
 *
 * @example
 * const result = await txCheckin({
 *   mcpToken: "mcp_pat_...",
 *   walletAddress: "0x...",
 *   chain: "eth",
 *   chainCategory: "evm",
 *   message: "Welcome to Uniswap! Nonce: abc123",
 * });
 * console.log(result.checkin_token);
 */
export async function txCheckin(params: CheckInParams): Promise<SuccessOut> {
  const rawToken = stripBearerPrefix(params.mcpToken);
  if (!rawToken) throw new Error("mcpToken 不能为空");

  const baseURL = (params.gatewayBaseURL ?? getEnvConfig().gvBaseUrl).replace(/\/$/, "");
  const method = "POST";

  // 构建 body
  const bodyJSON = buildBody(params);

  // 计算签名
  const ts = Math.floor(Date.now() / 1000);
  const apiCode = randomAPICode();
  const encPath = encodePathAndQuery(CHECKIN_PATH);
  const preimage = apiSignPreimage(method, encPath, bodyJSON, ts, apiCode);

  if (params.verbose) {
    process.stderr.write(`[tx-checkin] preimage:\n${preimage}\n`);
  }

  const apiSign = apiSignFromPreimage(preimage);
  const headers = buildHeaders(method, apiSign, ts, apiCode, rawToken);
  const fullURL = baseURL + CHECKIN_PATH;

  // 发送请求
  let resp: Awaited<ReturnType<typeof doRequest>>;
  try {
    printCurlReplayToStderr(method, fullURL, headers, bodyJSON);
    resp = await doRequest(method, fullURL, headers, bodyJSON);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    
    throw new Error(`HTTP 请求失败: ${msg}`);
  }

  // 解析响应 envelope
  const env = parseCheckInResponseBody(resp.body);

  if (resp.statusCode !== 200) {
    throw new Error(
      `HTTP ${resp.statusText} — gateway code=${env.code} msg=${env.msg}`
    );
  }

  // 提取业务结果（code !== 0 会抛错）
  return resultFromEnvelope(env);
}
