// ---------- 响应类型 ----------

export interface CheckInData {
  checkin_token: string;
  need_otp: boolean;
}

export interface Envelope {
  code: number;
  msg: string;
  data?: CheckInData;
}

export interface SuccessOut {
  ok: boolean;
  checkin_token?: string;
  need_otp: boolean;
}

// ---------- 解析函数 ----------

/**
 * parseCheckInResponseBody: 解析网关 JSON envelope。
 */
export function parseCheckInResponseBody(body: string): Envelope {
  let env: Envelope;
  try {
    env = JSON.parse(body) as Envelope;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON response: ${msg}`);
  }
  return env;
}

/**
 * resultFromEnvelope: 从 envelope 提取业务结果，code !== 0 视为失败。
 */
export function resultFromEnvelope(env: Envelope): SuccessOut {
  if (env.code !== 0) {
    throw new Error(`gateway code=${env.code} msg=${env.msg}`);
  }
  if (!env.data) {
    throw new Error("success code=0 but data is missing");
  }
  return {
    ok: true,
    checkin_token: env.data.checkin_token,
    need_otp: env.data.need_otp,
  };
}
