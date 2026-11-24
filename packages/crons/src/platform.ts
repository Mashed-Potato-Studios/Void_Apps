/**
 * Host surface used by the runtime-neutral adapters.
 *
 * No `node:` imports, no Node globals, and no assumption about which JS engine
 * runs the code. Every capability is injectable; the defaults resolve from
 * host globals lazily so importing these modules is safe in Workers, Deno,
 * Bun, Node, browsers, and test VMs.
 */

export interface CronFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect?: string;
}

export interface CronFetchResponse {
  ok: boolean;
  status: number;
}

export interface CronAbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

export interface CronPlatform {
  now(): number;
  /** Correlation ID generator. Not required to be cryptographically secure. */
  newId(): string;
  sleep(ms: number): Promise<void>;
  fetch(input: string, init: CronFetchInit): Promise<CronFetchResponse>;
  createAbortController(): CronAbortController;
}

type GlobalWithExtras = typeof globalThis & {
  crypto?: { randomUUID?: () => string };
  AbortController?: new () => AbortController;
};

function host(): GlobalWithExtras {
  return globalThis as GlobalWithExtras;
}

function fallbackId(): string {
  // IDs are correlation handles, not secrets; deterministic is unnecessary.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function shimAbortController(): CronAbortController {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    addEventListener(_type: string, listener: () => void): void {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void): void {
      listeners.delete(listener);
    },
    throwIfAborted(): void {
      if (signal.aborted) throw new Error("aborted");
    },
  } as unknown as AbortSignal;
  return {
    signal,
    abort(): void {
      if (signal.aborted) return;
      (signal as { aborted: boolean }).aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

function defaultCreateAbortController(): CronAbortController {
  const Ctor = host().AbortController;
  if (typeof Ctor === "function") return new Ctor();
  return shimAbortController();
}

function defaultFetch(input: string, init: CronFetchInit): Promise<CronFetchResponse> {
  const fetchImpl = host().fetch;
  if (typeof fetchImpl !== "function") {
    return Promise.reject(new Error("no fetch implementation in this runtime; supply platform.fetch"));
  }
  return fetchImpl(input, init as RequestInit) as Promise<CronFetchResponse>;
}

const BASE: CronPlatform = {
  now: () => Date.now(),
  newId: () => host().crypto?.randomUUID?.() ?? fallbackId(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  fetch: defaultFetch,
  createAbortController: defaultCreateAbortController,
};

/** Build a platform from host globals with explicit overrides. */
export function createPlatform(overrides: Partial<CronPlatform> = {}): CronPlatform {
  return { ...BASE, ...overrides };
}

/** A stable platform instance using host globals. */
export const defaultPlatform: CronPlatform = BASE;

/** Deterministic platform for tests and replayable runs. */
export function fixedPlatform(options: {
  now?: number | (() => number);
  ids?: string[];
  fetch?: CronPlatform["fetch"];
  sleep?: CronPlatform["sleep"];
} = {}): CronPlatform {
  let tick = 0;
  const ids = [...(options.ids ?? [])];
  const clock = typeof options.now === "number" ? () => options.now as number : options.now ?? (() => 0);
  return createPlatform({
    now: clock,
    newId: () => ids.shift() ?? `id-${tick++}`,
    sleep: options.sleep ?? (async () => {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    createAbortController: defaultCreateAbortController,
  });
}

/**
 * Bridge an optional caller-owned signal into a platform-owned controller.
 * Works with any host that provides `addEventListener`, and also with the
 * built-in fallback controller. Always call `cleanup()` when finished.
 */
export function linkAbortSignal(
  platform: CronPlatform,
  external: AbortSignal | undefined,
): { controller: CronAbortController; cleanup(): void } {
  const controller = platform.createAbortController();
  if (!external) return { controller, cleanup: () => {} };
  if (external.aborted) controller.abort();
  const relay = (): void => controller.abort();
  external.addEventListener("abort", relay);
  return {
    controller,
    cleanup(): void {
      external.removeEventListener("abort", relay);
    },
  };
}
