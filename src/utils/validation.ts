export function parsePossiblyNestedJson(text: string): unknown {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function buildRequestInit(method: string, body?: string): RequestInit {
  if (method === "GET") {
    return { method: "GET" };
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    if (body && body.trim()) {
      JSON.parse(body);
    }

    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && body.trim() ? body : undefined,
    };
  }

  throw new Error(`不支持的 method: ${method}`);
}
