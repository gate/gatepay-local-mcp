const GATE_PAY_OAUTH_LOG = "[Gate Pay OAuth]";

export function logGatePayOAuth(msg: string, detail?: unknown): void {
  if (detail === undefined) {
    console.error(`${GATE_PAY_OAUTH_LOG} ${msg}`);
    return;
  }
  const serialized =
    typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
  console.error(`${GATE_PAY_OAUTH_LOG} ${msg}`, serialized);
}
