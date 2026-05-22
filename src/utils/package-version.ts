import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let _version: string | undefined;

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return startDir;
    dir = parent;
  }
}

/** 读取 package.json 的 version 字段，结果缓存 */
export function readPackageVersion(): string {
  if (_version !== undefined) return _version;

  try {
    const root = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
    _version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    _version = "0.0.0";
  }

  return _version;
}
