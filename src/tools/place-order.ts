import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeX402RequestInput } from "../modes/input-normalizer.js";
import { buildRequestInit } from "../utils/validation.js";
import { createErrorResponse, createSuccessResponse, handleRequestError } from "../utils/response-helpers.js";

export async function handlePlaceOrder(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const normalized = normalizeX402RequestInput(args);
    
    if (!normalized.url || !normalized.url.startsWith("http")) {
      return createErrorResponse("缺少或无效参数 url（需完整 http/https URL）。");
    }

    const init = buildRequestInit(normalized.method, normalized.body);
    
    const response = await fetch(normalized.url, init);
    const responseText = await response.text();
    
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    const result = {
      request: {
        url: normalized.url,
        method: normalized.method,
        body: normalized.body || null,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: responseText,
      },
    };
    
    return createSuccessResponse(JSON.stringify(result, null, 2));
  } catch (err) {
    return await handleRequestError(err);
  }
}
