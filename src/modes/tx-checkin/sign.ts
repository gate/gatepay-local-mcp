import { createHash } from "crypto";

/**
 * bodyJSONForSign: 空 body 按网关规则签名为 "{}"
 */
function bodyJSONForSign(bodyJSON: string): string {
  return bodyJSON.trim() === "" ? "{}" : bodyJSON;
}

/**
 * APISignPreimage 返回 api-sign 的原文（SHA256 之前）。
 * 格式同网关 getReqHash: METHOD|path+query|data|timestamp|apiCode
 */
export function apiSignPreimage(
  method: string,
  encodedPathAndQuery: string,
  bodyJSON: string,
  timestampSec: number,
  apiCode: number
): string {
  const data = bodyJSONForSign(bodyJSON);
  return [
    method.trim().toUpperCase(),
    encodedPathAndQuery,
    data,
    String(timestampSec),
    String(apiCode),
  ].join("|");
}

/**
 * apiSignFromPreimage: SHA256(preimage)[24:32] → 小写 hex (16 chars)
 */
export function apiSignFromPreimage(preimage: string): string {
  const digest = createHash("sha256").update(preimage, "utf8").digest();
  return digest.slice(24, 32).toString("hex");
}

/**
 * computeAPISign: 一步计算 api-sign
 */
export function computeAPISign(
  method: string,
  encodedPathAndQuery: string,
  bodyJSON: string,
  timestampSec: number,
  apiCode: number
): string {
  return apiSignFromPreimage(
    apiSignPreimage(method, encodedPathAndQuery, bodyJSON, timestampSec, apiCode)
  );
}

/**
 * encodePathSegments: 逐段 percent-encode path（跳过空段）
 */
function encodePathSegments(p: string): string {
  return p
    .split("/")
    .map((seg) => (seg === "" ? seg : encodeURIComponent(seg)))
    .join("/");
}

/**
 * encodePathAndQuery: 对 path 逐段编码，query 用 URLSearchParams 归一化。
 * pathAndQuery 必须以 '/' 开头。
 */
export function encodePathAndQuery(pathAndQuery: string): string {
  if (!pathAndQuery) throw new Error("path is empty");
  if (!pathAndQuery.startsWith("/")) throw new Error("path must start with /");

  const qIdx = pathAndQuery.indexOf("?");
  if (qIdx < 0) {
    return encodePathSegments(pathAndQuery);
  }

  const rawPath = pathAndQuery.slice(0, qIdx);
  const rawQuery = pathAndQuery.slice(qIdx + 1);
  const params = new URLSearchParams(rawQuery);
  return `${encodePathSegments(rawPath)}?${params.toString()}`;
}
