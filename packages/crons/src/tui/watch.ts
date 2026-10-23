import { watch as fsWatch } from "node:fs";
import { join } from "node:path";

export interface WatchHandle {
  close(): void;
  on(event: "error", listener: () => void): unknown;
}

export type WatchImpl = (
  path: string,
  options: { recursive?: boolean },
  listener: (eventType: string, filename: string | null) => void,
) => WatchHandle;

export interface WatcherHandle {
  close(): void;
  failed: boolean;
}

export interface WatcherOptions {
  debounceMs?: number;
  watchImpl?: WatchImpl;
}

const DEFAULT_DEBOUNCE_MS = 200;

export function startWatcher(
  appPath: string,
  onChange: () => void,
  opts: WatcherOptions = {},
): WatcherHandle {
  const watchImpl: WatchImpl =
    opts.watchImpl ?? ((path, options, listener) => fsWatch(path, options, listener));
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const handles: WatchHandle[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let failed = false;

  const schedule = (): void => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, debounceMs);
  };

  const onCrons = (_event: string, filename: string | null): void => {
    if (filename === null || !filename.includes("void.crons.activity")) schedule();
  };

  const onRoot = (_event: string, filename: string | null): void => {
    if (filename !== null && filename !== "void.crons.json") return;
    schedule();
  };

  try {
    handles.push(watchImpl(join(appPath, "crons"), { recursive: true }, onCrons));
    handles.push(watchImpl(appPath, {}, onRoot));
  } catch {
    failed = true;
  }

  for (const handle of handles) {
    try {
      handle.on("error", () => {
        failed = true;
      });
    } catch {
      failed = true;
    }
  }

  return {
    get failed(): boolean {
      return failed;
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const handle of handles) {
        try {
          handle.close();
        } catch {
          // Best effort.
        }
      }
    },
  };
}
