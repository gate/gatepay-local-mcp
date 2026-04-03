import fs from "fs";
import path from "path";
import os from "os";

interface McpServerEntry {
  headers?: Record<string, string>;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerEntry>;
}

/** 优先匹配含 gate/wallet/dex/mcp 的 server key */
const PREFER_SERVER_PATTERN = /gate|wallet|dex|mcp/i;

/**
 * stripBearerPrefix: 去掉 "Bearer " 前缀（大小写不敏感）
 */
function stripBearerPrefix(s: string): string {
  s = s.trim();
  if (s.length > 7 && s.slice(0, 7).toLowerCase() === "bearer ") {
    return s.slice(7).trim();
  }
  return s;
}

function mcpJSONHintPath(): string {
  const env = (process.env["CURSOR_MCP_JSON"] ?? "").trim();
  if (env) return env;
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

function tokenFromServerHeaders(headers?: Record<string, string>): string {
  if (!headers) return "";
  for (const [k, v] of Object.entries(headers)) {
    if (k.trim().toLowerCase() === "authorization") {
      return stripBearerPrefix(v);
    }
  }
  return "";
}

function authFromCursorMCPJSON(): string {
  const mcpPath = (process.env["CURSOR_MCP_JSON"] ?? "").trim() || path.join(os.homedir(), ".cursor", "mcp.json");

  let data: string;
  try {
    data = fs.readFileSync(mcpPath, "utf8");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`read ${mcpPath}: ${msg}`);
  }

  let cfg: McpConfigFile;
  try {
    cfg = JSON.parse(data) as McpConfigFile;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`parse ${mcpPath}: ${msg}`);
  }

  const servers = cfg.mcpServers ?? {};
  if (Object.keys(servers).length === 0) return "";

  // 优先使用 TX_CHECKIN_MCP_SERVER 指定的 key
  const preferKey = (process.env["TX_CHECKIN_MCP_SERVER"] ?? "").trim();
  if (preferKey && servers[preferKey]) {
    return tokenFromServerHeaders(servers[preferKey].headers);
  }

  // 否则按 name 模式优先
  let fallback = "";
  for (const [name, ent] of Object.entries(servers)) {
    const tok = tokenFromServerHeaders(ent.headers);
    if (!tok) continue;
    if (PREFER_SERVER_PATTERN.test(name)) return tok;
    if (!fallback) fallback = tok;
  }
  return fallback;
}

/**
 * resolveMCPToken: 解析 MCP token（去掉 Bearer 前缀的裸 token）。
 * 优先顺序：MCP_TOKEN 环境变量 → ~/.cursor/mcp.json
 */
export function resolveMCPToken(): string {
  const envToken = stripBearerPrefix(process.env["MCP_TOKEN"] ?? "");
  if (envToken) return envToken;

  const token = authFromCursorMCPJSON();
  if (!token) {
    throw new Error(
      `no token: set MCP_TOKEN or add Authorization in ${mcpJSONHintPath()} mcpServers.*.headers`
    );
  }
  return token;
}
