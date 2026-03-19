import test from "node:test";
import assert from "node:assert/strict";

import {
  SignModeSelectionError,
  createSignModeRegistry,
} from "../../src/sign-modes/registry.js";
import type {
  ResolvedSignerSession,
  SignModeAvailability,
  SignModeDefinition,
} from "../../src/sign-modes/types.js";
import type { ClientEvmSigner } from "../../src/x402-standalone/types.js";

function createStubSigner(): ClientEvmSigner {
  return {
    address: "0x1111111111111111111111111111111111111111",
    async signTypedData() {
      return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1b";
    },
    async signDigest() {
      return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1b";
    },
  };
}

function createMode(
  id: SignModeDefinition["id"],
  priority: number,
  availability: SignModeAvailability,
): SignModeDefinition {
  return {
    id,
    priority,
    checkAvailability() {
      return availability;
    },
    async resolveSigner(): Promise<ResolvedSignerSession> {
      return {
        signer: createStubSigner(),
        cacheKey: id,
      };
    },
  };
}

test("selects the highest-priority ready mode when sign_mode is omitted", async () => {
  const registry = createSignModeRegistry([
    createMode("quick_wallet", 20, { status: "ready", summary: "ready" }),
    createMode("local_private_key", 10, { status: "ready", summary: "ready" }),
  ]);

  const result = await registry.selectMode();

  assert.equal(result.mode.id, "local_private_key");
});

test("allows an explicitly requested quick_wallet mode to continue when login is required", async () => {
  const registry = createSignModeRegistry([
    createMode("quick_wallet", 20, {
      status: "needs_login",
      summary: "needs login",
      missing: ["mcp_token"],
    }),
  ]);

  const result = await registry.selectMode("quick_wallet");

  assert.equal(result.mode.id, "quick_wallet");
  assert.equal(result.availability.status, "needs_login");
});

test("returns no_mode_available when no ready mode exists for auto-selection", async () => {
  const registry = createSignModeRegistry([
    createMode("local_private_key", 10, {
      status: "not_configured",
      summary: "missing key",
      missing: ["EVM_PRIVATE_KEY"],
    }),
    createMode("quick_wallet", 20, {
      status: "needs_login",
      summary: "needs login",
      missing: ["mcp_token"],
    }),
  ]);

  await assert.rejects(
    registry.selectMode(),
    (error: unknown) =>
      error instanceof SignModeSelectionError &&
      error.code === "no_mode_available",
  );
});

test("returns unknown_mode for unsupported explicit sign_mode", async () => {
  const registry = createSignModeRegistry([
    createMode("local_private_key", 10, { status: "ready", summary: "ready" }),
  ]);

  await assert.rejects(
    registry.selectMode("plugin_wallet"),
    (error: unknown) =>
      error instanceof SignModeSelectionError &&
      error.code === "unknown_mode",
  );
});

test("reuses an initialized payFetch for repeated calls", async () => {
  let resolveSignerCalls = 0;
  let buildCalls = 0;
  const registry = createSignModeRegistry(
    [
      {
        id: "local_private_key",
        priority: 10,
        checkAvailability() {
          return { status: "ready", summary: "ready" } as const;
        },
        async resolveSigner() {
          resolveSignerCalls += 1;
          return { signer: createStubSigner() };
        },
        getCacheKey() {
          return "local_private_key";
        },
      },
    ],
    {
      build() {
        buildCalls += 1;
        return fetch;
      },
    },
  );

  const mode = (await registry.selectMode()).mode;
  const payFetchA = await registry.getOrCreatePayFetch(mode, {
    walletLoginProvider: "gate",
  });
  const payFetchB = await registry.getOrCreatePayFetch(mode, {
    walletLoginProvider: "gate",
  });

  assert.equal(resolveSignerCalls, 1);
  assert.equal(buildCalls, 1);
  assert.equal(payFetchA, payFetchB);
});

test("coalesces concurrent payFetch initialization for the same mode", async () => {
  let resolveSignerCalls = 0;
  let buildCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const registry = createSignModeRegistry(
    [
      {
        id: "local_private_key",
        priority: 10,
        checkAvailability() {
          return { status: "ready", summary: "ready" } as const;
        },
        async resolveSigner() {
          resolveSignerCalls += 1;
          await gate;
          return { signer: createStubSigner() };
        },
        getCacheKey() {
          return "local_private_key";
        },
      },
    ],
    {
      build() {
        buildCalls += 1;
        return fetch;
      },
    },
  );

  const mode = (await registry.selectMode()).mode;
  const pendingA = registry.getOrCreatePayFetch(mode, {
    walletLoginProvider: "gate",
  });
  const pendingB = registry.getOrCreatePayFetch(mode, {
    walletLoginProvider: "gate",
  });

  release();
  const [payFetchA, payFetchB] = await Promise.all([pendingA, pendingB]);

  assert.equal(resolveSignerCalls, 1);
  assert.equal(buildCalls, 1);
  assert.equal(payFetchA, payFetchB);
});
