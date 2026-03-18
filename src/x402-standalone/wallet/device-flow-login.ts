/**
 * MCP Device Flow 登录 - 可复用模块
 * 从 auth.cmd.ts 的 loginWithDeviceFlow 场景抽取，供 CLI 及其他调用方使用。
 */

import { spawn } from "node:child_process";
import type { GateMcpClient } from "./wallet-mcp-clients.js";
import { saveAuth, getAuthFilePath } from "./auth-token-store.js";

// ─── 跨平台打开浏览器（从 oauth 迁入，避免依赖 oauth 模块）────────────

export async function openBrowser(url: string): Promise<boolean> {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(cmd, [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    printManualUrl(url);
    return false;
  }
}

function printManualUrl(url: string): void {
  const termLink = `\x1b]8;;${url}\x1b\\Click here to open\x1b]8;;\x1b\\`;
  console.log();
  console.log(`\x1b[33m⚠  Could not open browser automatically.\x1b[0m`);
  console.log(`\x1b[1m   ${termLink}\x1b[0m  or copy the URL below:`);
  console.log();
  console.log(`   \x1b[36m${url}\x1b[0m`);
  console.log();
}

// ─── 类型与工具 ───────────────────────────────────────────

export interface DeviceFlowLoginOptions {
  /** 是否保存 token 到默认 auth 文件，默认 true */
  saveToken?: boolean;
  /** 登录成功后是否上报钱包地址，默认 true */
  reportAddresses?: boolean;
}

/** 登录结果：成功返回 true，失败/取消/超时返回 false */
export type DeviceFlowLoginResult = boolean;

function parseToolResult<T>(
  result: Awaited<ReturnType<GateMcpClient["callTool"]>>,
): T | null {
  if ("content" in result && Array.isArray(result.content)) {
    const text = (
      result.content as Array<{ type: string; text?: string }>
    ).find(
      (c): c is { type: "text"; text: string } =>
        c.type === "text" && typeof c.text === "string",
    );
    if (text) {
      try {
        return JSON.parse(text.text) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── 登录后上报钱包地址（可选）────────────────────────────

interface WalletAddresses {
  account_id?: string;
  addresses?: Record<string, string>;
}

interface AgenticChainAddress {
  networkKey: string;
  accountKey?: string;
  chains: string;
  accountFormat?: string;
  chainAddress: string;
}

const CHAIN_ADDRESS_MAP: Record<
  string,
  Omit<AgenticChainAddress, "chainAddress">
> = {
  EVM: {
    networkKey: "ETH",
    accountKey: "ETH",
    chains: "ETH,ARB,OP,BASE,LINEA,SCROLL,ZKSYNC",
    accountFormat: "",
  },
  SOL: {
    networkKey: "SOL",
    chains: "SOL",
  },
};

async function reportWalletAddresses(mcp: GateMcpClient): Promise<void> {
  console.log("Reporting wallet addresses...");

  try {
    const addrResult = await mcp.callTool("wallet.get_addresses");
    const addrData = parseToolResult<WalletAddresses>(addrResult);

    if (!addrData?.addresses || Object.keys(addrData.addresses).length === 0) {
      console.warn("No wallet addresses to report");
      return;
    }

    const chainAddressList: AgenticChainAddress[] = Object.entries(
      addrData.addresses,
    )
      .map(([chainType, address]) => {
        const meta = CHAIN_ADDRESS_MAP[chainType];
        if (!meta) return null;
        return { ...meta, chainAddress: address };
      })
      .filter((item): item is AgenticChainAddress => item !== null);

    if (chainAddressList.length === 0) {
      console.warn("No supported chains to report");
      return;
    }

    const wallets = [
      {
        accounts: [{ chainAddressList }],
      },
    ];

    const reportResult = await mcp.callTool("agentic.report", { wallets });
    const report = parseToolResult<{
      wallets?: Array<{ walletID: string; accountID: string[] }>;
    }>(reportResult);

    if (report?.wallets?.length) {
      console.log(
        `Wallet addresses reported (${chainAddressList.length} chains)`,
      );
      for (const w of report.wallets) {
        console.log(`  walletID: ${w.walletID}`);
      }
    } else {
      console.warn("Wallet report returned empty result");
    }
  } catch (err) {
    console.warn(`Wallet report failed: ${(err as Error).message}`);
  }
}

// ─── 主入口：MCP Device Flow 登录 ─────────────────────────

/**
 * 使用 MCP Device Flow 完成 Gate/Google 登录。
 * 会启动 device flow、打开浏览器、轮询直至授权完成，并可选保存 token、上报地址。
 *
 * @param mcp 已连接的 GateMcpClient
 * @param serverUrl MCP 服务 URL（保存 token 时写入）
 * @param isGoogle 是否使用 Google OAuth，否则为 Gate
 * @param provider 展示用名称，如 "Google" / "Gate"
 * @param options 可选：saveToken、reportAddresses
 * @returns 成功返回 true，失败/取消/超时返回 false
 */
export async function loginWithDeviceFlow(
  mcp: GateMcpClient,
  serverUrl: string,
  isGoogle: boolean,
  provider: string,
  options?: DeviceFlowLoginOptions,
): Promise<DeviceFlowLoginResult> {
  const { saveToken = true, reportAddresses = true } = options ?? {};

  console.log(`Starting ${provider} OAuth login...`);

  let startResult;
  try {
    startResult = isGoogle
      ? await mcp.authGoogleLoginStart()
      : await mcp.authGateLoginStart();
  } catch (err) {
    console.error(`Failed to start device flow: ${(err as Error).message}`);
    return false;
  }

  const parsed = parseToolResult<{
    flow_id?: string;
    verification_url?: string;
    user_code?: string;
    expires_in?: number;
    interval?: number;
  }>(startResult);

  if (!parsed?.verification_url || !parsed?.flow_id) {
    console.error("Failed to start login flow (invalid response)");
    return false;
  }

  const intervalMs = (parsed.interval ?? 5) * 1000;
  const expiresInSec = parsed.expires_in ?? 1800;
  const deadline = Date.now() + expiresInSec * 1000;

  console.log("Login flow started (MCP device flow)");
  console.log(`  flow_id: ${parsed.flow_id}`);
  console.log(`  poll interval: ${intervalMs / 1000}s, expires_in: ${expiresInSec}s`);

  if (parsed.user_code) {
    console.log(`  Code: ${parsed.user_code}`);
  }

  const opened = await openBrowser(parsed.verification_url);
  if (opened) {
    console.log("  ✔ Browser opened — please authorize there.");
  } else {
    console.log("  → Open the URL above in browser to authorize.");
  }

  console.log("Waiting for authorization (polling MCP)...");
  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
  };
  process.once("SIGINT", onSigint);

  let pollCount = 0;
  while (Date.now() < deadline && !cancelled) {
    await sleep(intervalMs);
    pollCount += 1;
    const remainingSec = Math.round((deadline - Date.now()) / 1000);
    console.log(`  [poll #${pollCount}] auth.${isGoogle ? "google" : "gate"}_login_poll(flow_id=${parsed.flow_id.slice(0, 12)}...) — remaining ~${remainingSec}s`);

    try {
      const pollResult = isGoogle
        ? await mcp.authGoogleLoginPoll(parsed.flow_id)
        : await mcp.authGateLoginPoll(parsed.flow_id);

      const poll = parseToolResult<{
        status: string;
        error?: string;
        access_token?: string;
        mcp_token?: string;
        user_id?: string;
        expires_in?: number;
        /** 实际返回：登录成功时在 login_result 里 */
        login_result?: {
          mcp_token?: string;
          user_id?: string;
          expires_in?: number;
          expired_at?: number;
        };
      }>(pollResult);

      if (!poll) {
        console.log(`  [poll #${pollCount}] MCP returned no parseable result (pending?), continuing...`);
        continue;
      }
      console.log(`  [poll #${pollCount}] MCP status: ${poll.status}${poll.error ? ` error=${poll.error}` : ""}`);

      if (poll.status === "ok") {
        const login = poll.login_result;
        const token =
          login?.mcp_token ?? poll.access_token ?? poll.mcp_token;
        const userId = login?.user_id ?? poll.user_id;
        const expiresIn = login?.expires_in ?? poll.expires_in;
        if (token) {
          mcp.setMcpToken(token);
          process.removeListener("SIGINT", onSigint);
          console.log("Login successful!");

          if (saveToken) {
            saveAuth({
              mcp_token: token,
              provider: isGoogle ? "google" : "gate",
              user_id: userId,
              expires_at: expiresIn
                ? Date.now() + expiresIn * 1000
                : Date.now() + 30 * 86_400_000,
              env: "default",
              server_url: serverUrl,
            });
          }

          console.log();
          if (userId) console.log(`  User ID: ${userId}`);
          console.log(`  Wallet: custodial (${provider})`);
          if (saveToken) {
            console.log(`  Token saved to ${getAuthFilePath()}`);
          }

          if (reportAddresses) {
            await reportWalletAddresses(mcp);
          }
          return true;
        }
      }

      if (poll.status === "error") {
        process.removeListener("SIGINT", onSigint);
        console.error(`Login failed: ${poll.error ?? "Unknown error"}`);
        return false;
      }
    } catch (err) {
      console.warn(`  [poll #${pollCount}] MCP poll request failed:`, (err as Error).message, "— will retry...");
    }
  }

  process.removeListener("SIGINT", onSigint);
  console.error(cancelled ? "Login cancelled" : "Login timed out");
  return false;
}
