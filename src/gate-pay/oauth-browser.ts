import { spawn } from "node:child_process";
import { logGatePayOAuth } from "./oauth-log.js";

export async function openBrowser(url: string): Promise<boolean> {
  logGatePayOAuth("openBrowser: 参数 url（全量）", url);
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
  console.error("");
  console.error(`\x1b[33m⚠  Could not open browser automatically.\x1b[0m`);
  console.error(`\x1b[1m   ${termLink}\x1b[0m  or copy the URL below:`);
  console.error("");
  console.error(`   \x1b[36m${url}\x1b[0m`);
  console.error("");
}
