import test from "node:test";
import assert from "node:assert/strict";

import { normalizeX402RequestInput } from "../../src/sign-modes/input-normalizer.js";

test("prefers sign_mode over auth_mode when both are provided", () => {
  const normalized = normalizeX402RequestInput({
    url: "https://example.com/pay",
    sign_mode: "local_private_key",
    auth_mode: "quick_wallet",
    wallet_login_provider: "google",
  });

  assert.equal(normalized.url, "https://example.com/pay");
  assert.equal(normalized.signMode, "local_private_key");
  assert.equal(normalized.walletLoginProvider, "google");
});

test("maps legacy auth_mode quick_wallet to sign_mode", () => {
  const normalized = normalizeX402RequestInput({
    url: "https://example.com/pay",
    auth_mode: "quick_wallet",
  });

  assert.equal(normalized.signMode, "quick_wallet");
  assert.equal(normalized.walletLoginProvider, "gate");
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
