/**
 * 从工具入参拼出埋点字段 `request`：「METHOD URL」。
 * 仅包含方法与完整 URL（含 query），不包含 header、body。
 * 无可用 http(s) URL 时返回 undefined（上报侧可省略该字段）。
 */
export function formatTrackingRequest(args: Record<string, unknown> | undefined): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  const pickUrl = (): string | undefined => {
    const resource = args.resource_url;
    if (typeof resource === "string") {
      const t = resource.trim();
      if (t.startsWith("http://") || t.startsWith("https://")) return t;
    }
    const u = args.url;
    if (typeof u === "string") {
      const t = u.trim();
      if (t.startsWith("http://") || t.startsWith("https://")) return t;
    }
    return undefined;
  };

  const url = pickUrl();
  if (!url) return undefined;

  let method = "POST";
  const rawM = args.method;
  if (typeof rawM === "string" && rawM.trim() !== "") {
    method = rawM.trim().toUpperCase();
  }

  return `${method} ${url}`;
}

/** 与火山侧字段长度限制配合，避免极长 URL 撑爆 payload */
export function truncateRequest(s: string, max = 2048): string {
  return s.length <= max ? s : s.slice(0, max) + "...";
}
