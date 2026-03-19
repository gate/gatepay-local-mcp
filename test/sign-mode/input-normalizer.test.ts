import test from "node:test";
import assert from "node:assert/strict";

import { normalizeX402RequestInput } from "../../src/sign-modes/input-normalizer.js";

test("uses sign_mode when provided", () => {
  const normalized = normalizeX402RequestInput({
    url: "https://example.com/pay",
    sign_mode: "local_private_key",
    wallet_login_provider: "google",
  });

  assert.equal(normalized.url, "https://example.com/pay");
  assert.equal(normalized.signMode, "local_private_key");
  assert.equal(normalized.walletLoginProvider, "google");
});

test("leaves signMode undefined when no mode is provided", () => {
  const normalized = normalizeX402RequestInput({
    url: "https://example.com/pay",
  });

  assert.equal(normalized.signMode, undefined);
  assert.equal(normalized.walletLoginProvider, "gate");
});

test("normalizes method and body fields", () => {
  const normalized = normalizeX402RequestInput({
    url: "https://example.com/pay",
    method: "patch",
    body: '{"ok":true}',
  });

  assert.equal(normalized.method, "PATCH");
  assert.equal(normalized.body, '{"ok":true}');
});
