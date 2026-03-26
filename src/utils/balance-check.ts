import { getMcpClientSync } from "../wallets/wallet-mcp-clients.js";
import { parsePossiblyNestedJson } from "./validation.js";

const INSUFFICIENT_BALANCE_CODE = "800001001";

export function containsInsufficientBalanceSignal(message: string): boolean {
  return message.toLowerCase().includes("insufficient balance");
}

export async function buildInsufficientBalanceReply(baseMessage: string): Promise<string> {
  const mcp = getMcpClientSync();
  if (!mcp || !mcp.isAuthenticated()) {
    return [
      "支付失败：检测到余额不足。",
      `原始信息: ${baseMessage}`,
      "当前无法获取钱包余额（未检测到已登录的托管钱包会话）。",
    ].join("\n");
  }

  try {
    const tokenListResult = await mcp.walletGetTokenList();
    const content = (tokenListResult as { content?: unknown[] }).content;
    const first = Array.isArray(content)
      ? (content[0] as { type?: string; text?: string } | undefined)
      : undefined;
    const balances =
      first?.type === "text" && typeof first.text === "string"
        ? parsePossiblyNestedJson(first.text) ?? first.text
        : tokenListResult;

    return JSON.stringify(
      {
        code: Number(INSUFFICIENT_BALANCE_CODE),
        message: "余额不足，已返回当前钱包余额信息",
        originalMessage: baseMessage,
        walletBalances: balances,
      },
      null,
      2,
    );
  } catch (error) {
    return [
      "支付失败：检测到余额不足。",
      `原始信息: ${baseMessage}`,
      `查询钱包余额失败: ${error instanceof Error ? error.message : String(error)}`,
    ].join("\n");
  }
}
