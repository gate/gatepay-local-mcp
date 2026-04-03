/**
 * shellQuoteBash: 用单引号包裹字符串，内部的 ' 转义为 '\''（bash 安全）
 */
function shellQuoteBash(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/**
 * buildCurlCheckIn: 构建可复现同一请求的 curl bash 命令（多行格式）。
 */
export function buildCurlCheckIn(
  method: string,
  fullURL: string,
  headers: Record<string, string>,
  body: string
): string {
  const m = method.trim().toUpperCase();
  const lines: string[] = [`curl -sS -X ${m} ${shellQuoteBash(fullURL)}`];

  const sortedKeys = Object.keys(headers).sort();
  for (const k of sortedKeys) {
    lines.push(`  -H ${shellQuoteBash(`${k}: ${headers[k]}`)}`);
  }

  if (m === "POST" && body.length > 0) {
    lines.push(`  --data-binary ${shellQuoteBash(body)}`);
  }

  return lines.join(" \\\n") + "\n";
}

/**
 * printCurlReplayToStderr: 向 stderr 打印 curl 重放命令（用于调试失败请求）。
 */
export function printCurlReplayToStderr(
  method: string,
  fullURL: string,
  headers: Record<string, string>,
  body: string
): void {
  process.stderr.write(`\n# Replay with curl (same request):\n${buildCurlCheckIn(method, fullURL, headers, body)}`);
}
