import { DefaultPayFetchFactory } from "./build-pay-fetch.js";
import type {
  PayFetchFactory,
  ResolveSignerContext,
  SelectModeResult,
  SignModeDefinition,
  SignModeId,
} from "./types.js";

type SelectionErrorCode =
  | "unknown_mode"
  | "no_mode_available"
  | "mode_not_ready"
  | "mode_init_failed";

export class SignModeSelectionError extends Error {
  readonly code: SelectionErrorCode;
  readonly mode?: string;
  readonly supportedModes?: string[];
  readonly missing?: string[];
  readonly availableHints?: string[];

  constructor(params: {
    code: SelectionErrorCode;
    message: string;
    mode?: string;
    supportedModes?: string[];
    missing?: string[];
    availableHints?: string[];
  }) {
    super(params.message);
    this.name = "SignModeSelectionError";
    this.code = params.code;
    this.mode = params.mode;
    this.supportedModes = params.supportedModes;
    this.missing = params.missing;
    this.availableHints = params.availableHints;
  }
}

export interface SignModeRegistry {
  selectMode(requestedMode?: string): Promise<SelectModeResult>;
  getOrCreatePayFetch(mode: SignModeDefinition, context: ResolveSignerContext): Promise<typeof fetch>;
  listSupportedModes(): SignModeId[];
}

export function createSignModeRegistry(
  modes: SignModeDefinition[],
  payFetchFactory: PayFetchFactory = new DefaultPayFetchFactory(),
): SignModeRegistry {
  const registeredModes = new Map<SignModeId, SignModeDefinition>();
  const readyFetchCache = new Map<string, typeof fetch>();
  const initPromiseCache = new Map<string, Promise<typeof fetch>>();

  for (const mode of modes) {
    registeredModes.set(mode.id, mode);
  }

  async function selectMode(requestedMode?: string): Promise<SelectModeResult> {
    if (requestedMode) {
      const mode = registeredModes.get(requestedMode as SignModeId);
      if (!mode) {
        throw new SignModeSelectionError({
          code: "unknown_mode",
          message: `Unknown sign_mode: ${requestedMode}`,
          mode: requestedMode,
          supportedModes: listSupportedModes(),
        });
      }

      const availability = await mode.checkAvailability();
      if (availability.status === "not_configured") {
        throw new SignModeSelectionError({
          code: "mode_not_ready",
          message: availability.summary,
          mode: mode.id,
          missing: availability.missing,
        });
      }

      return { mode, availability };
    }

    const checkedModes = await Promise.all(
      listSupportedModes().map(async (modeId) => {
        const mode = registeredModes.get(modeId)!;
        const availability = await mode.checkAvailability();
        return { mode, availability };
      }),
    );

    const readyModes = checkedModes
      .filter((item) => item.availability.status === "ready")
      .sort((left, right) => left.mode.priority - right.mode.priority);

    if (readyModes.length === 0) {
      throw new SignModeSelectionError({
        code: "no_mode_available",
        message: "No sign mode is currently ready.",
        availableHints: checkedModes.map(
          ({ mode, availability }) => `${mode.id}: ${availability.summary}`,
        ),
      });
    }

    return readyModes[0];
  }

  async function getOrCreatePayFetch(
    mode: SignModeDefinition,
    context: ResolveSignerContext,
  ): Promise<typeof fetch> {
    const cacheKey = await getModeCacheKey(mode, context);
    const cached = readyFetchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = initPromiseCache.get(cacheKey);
    if (pending) {
      return pending;
    }

    const initPromise = (async () => {
      try {
        const session = await mode.resolveSigner(context);
        const payFetch = payFetchFactory.build({ signer: session.signer });
        readyFetchCache.set(cacheKey, payFetch);
        return payFetch;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SignModeSelectionError({
          code: "mode_init_failed",
          message,
          mode: mode.id,
        });
      } finally {
        initPromiseCache.delete(cacheKey);
      }
    })();

    initPromiseCache.set(cacheKey, initPromise);
    return initPromise;
  }

  function listSupportedModes(): SignModeId[] {
    return [...registeredModes.keys()];
  }

  return {
    selectMode,
    getOrCreatePayFetch,
    listSupportedModes,
  };
}

async function getModeCacheKey(
  mode: SignModeDefinition,
  context: ResolveSignerContext,
): Promise<string> {
  if (mode.getCacheKey) {
    return await mode.getCacheKey(context);
  }

  return mode.id;
}

export function formatSignModeSelectionError(error: unknown): string {
  if (!(error instanceof SignModeSelectionError)) {
    return error instanceof Error ? error.message : String(error);
  }

  if (error.code === "unknown_mode") {
    const supported = error.supportedModes?.join(", ") ?? "";
    return `未知 sign_mode: ${error.mode}。支持的模式：${supported}`;
  }

  if (error.code === "no_mode_available") {
    const hints = error.availableHints?.join("；") ?? "";
    return `当前没有可自动选择的 sign_mode。请先配置可用的 token、session 或本地私钥。${hints ? ` 状态：${hints}` : ""}`;
  }

  if (error.code === "mode_not_ready") {
    const missing = error.missing?.join(", ");
    return missing
      ? `sign_mode ${error.mode} 当前不可直接使用：${error.message} 缺失项：${missing}`
      : `sign_mode ${error.mode} 当前不可直接使用：${error.message}`;
  }

  return `sign_mode ${error.mode} 初始化失败：${error.message}`;
}
