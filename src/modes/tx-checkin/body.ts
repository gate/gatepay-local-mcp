import fs from "fs";
import { stdin as processStdin } from "process";

export const SOURCE_AI_AGENT = 3;

// ---------- 类型定义 ----------

export interface CheckInBody {
  wallet_address: string;
  chain: string;
  chain_category: string;
  message?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intent?: any;
  type?: string;
  source: number; // 固定 3 (aiAgent)
}

interface CheckInTxBundle {
  tx: string;
  category: string;
  enc: string;      // SOL: base58/base64/hex; 默认空
  network: { chainId: number };
  type: string;     // e.g. eip712; 默认空
}

export interface BodyInput {
  bodyFile?: string;
  wallet?: string;
  chain?: string;
  category?: string;
  message?: string;
  intent?: string;
  intentFile?: string;
  type?: string;
  txCheckinFile?: string;     // 文件：unsigned tx hex/base58 或含 unsigned_tx_hex/tx 字段的 JSON
  txCheckinCategory?: string; // EVM | SOL (别名: evm, solana, sol)
  txBundleFile?: string;      // 文件：dex_tx_transfer_preview 返回的 txBundle JSON 字符串
}

// ---------- 辅助函数 ----------

function normalizeTxCheckinCategory(s: string): string {
  switch (s.trim().toLowerCase()) {
    case "evm":
      return "EVM";
    case "sol":
    case "solana":
      return "SOL";
    default:
      throw new Error(`tx check-in category must be EVM or SOL, got "${s}"`);
  }
}

/**
 * txStringFromCheckinFile: 从文件内容提取 tx 字符串。
 * - 若内容是 JSON 对象，取 unsigned_tx_hex 或 tx 字段；
 * - 否则直接用 trim 后的内容。
 */
function txStringFromCheckinFile(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("tx file is empty");

  if (trimmed.startsWith("{")) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`tx file JSON: ${msg}`);
    }
    for (const key of ["unsigned_tx_hex", "tx"]) {
      const v = m[key];
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
    throw new Error(`tx file JSON must contain non-empty string field unsigned_tx_hex or tx`);
  }

  return trimmed;
}

/**
 * checkInMessagePayloadForSignTransaction:
 * 构建 dex_wallet_sign_transaction check-in 的 message 字段（compact JSON txbundle）。
 */
function checkInMessagePayloadForSignTransaction(txFileContent: string, category: string): string {
  const cat = normalizeTxCheckinCategory(category);
  const txStr = txStringFromCheckinFile(txFileContent);
  if (!txStr) throw new Error("tx string is empty");

  const bundle: CheckInTxBundle = {
    tx: txStr,
    category: cat,
    enc: "",
    network: { chainId: 0 },
    type: "",
  };
  return JSON.stringify(bundle);
}

/**
 * validateTxBundleMessageJSON: 验证 txbundle JSON 包含非空的 tx 和 category。
 */
function validateTxBundleMessageJSON(s: string): void {
  const trimmed = s.trim();
  if (!trimmed) throw new Error("tx-bundle file is empty");

  let b: Partial<CheckInTxBundle>;
  try {
    b = JSON.parse(trimmed) as Partial<CheckInTxBundle>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`tx-bundle JSON: ${msg}`);
  }
  if (!b.tx?.trim() || !b.category?.trim()) {
    throw new Error("tx-bundle must include non-empty tx and category");
  }
}

async function readFileOrStdin(filePath: string): Promise<string> {
  if (filePath === "-") {
    return readAllStdin();
  }
  return fs.readFileSync(filePath, "utf8");
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    processStdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    processStdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    processStdin.on("error", reject);
  });
}

// ---------- 主函数 ----------

/**
 * buildBodyJSON: 构建请求 JSON body（字符串）。
 * - GET → 空字符串
 * - POST + bodyFile → 读文件并补 source 字段
 * - POST + 其他参数 → 按字段构建 CheckInBody
 */
export async function buildBodyJSON(method: string, inp: BodyInput): Promise<string> {
  if (method.trim().toUpperCase() === "GET") {
    if (inp.bodyFile) throw new Error("GET method cannot be used with --body-file");
    return "";
  }

  // 直接使用 body 文件
  if (inp.bodyFile) {
    const raw = await readFileOrStdin(inp.bodyFile);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("body file is not valid JSON");
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      (parsed as Record<string, unknown>)["source"] = SOURCE_AI_AGENT;
    }
    return JSON.stringify(parsed);
  }

  // 校验必填字段
  if (!inp.wallet || !inp.chain || !inp.category) {
    throw new Error("wallet_address, chain, and chain_category are required (unless using --body-file)");
  }

  // 互斥参数检测
  const hasTxFile = !!(inp.txCheckinFile?.trim());
  const hasTxBundleFile = !!(inp.txBundleFile?.trim());
  const hasMsg = !!(inp.message?.trim());

  let intentParsed: unknown = undefined;
  if (inp.intentFile) {
    const raw = fs.readFileSync(inp.intentFile, "utf8").trim();
    try {
      intentParsed = JSON.parse(raw);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`intent file is not valid JSON: ${msg}`);
    }
  } else if (inp.intent?.trim()) {
    try {
      intentParsed = JSON.parse(inp.intent.trim());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`intent is not valid JSON: ${msg}`);
    }
  }
  const hasIntent = intentParsed !== undefined;

  const picks = [hasTxFile, hasTxBundleFile, hasMsg, hasIntent].filter(Boolean).length;
  if (picks > 1) {
    throw new Error("--message, --intent/--intent-file, --tx-checkin-file, and --tx-bundle-file are mutually exclusive");
  }
  if (picks === 0) {
    throw new Error("exactly one of --message, --intent, --tx-checkin-file, or --tx-bundle-file is required (unless using --body-file)");
  }

  // 构建 message 字段
  let msgForBody = (inp.message ?? "").trim();

  if (hasTxBundleFile) {
    const raw = fs.readFileSync(inp.txBundleFile!, "utf8");
    msgForBody = raw.trim();
    validateTxBundleMessageJSON(msgForBody);
  }

  if (hasTxFile) {
    if (!inp.txCheckinCategory?.trim()) {
      throw new Error("--tx-checkin-category is required with --tx-checkin-file (EVM or SOL)");
    }
    const raw = fs.readFileSync(inp.txCheckinFile!, "utf8");
    msgForBody = checkInMessagePayloadForSignTransaction(raw, inp.txCheckinCategory!);
  }

  const body: CheckInBody = {
    wallet_address: inp.wallet,
    chain: inp.chain,
    chain_category: inp.category,
    source: SOURCE_AI_AGENT,
  };

  if (msgForBody) body.message = msgForBody;
  if (hasIntent) body.intent = intentParsed;
  if (inp.type?.trim()) body.type = inp.type.trim();

  return JSON.stringify(body);
}
