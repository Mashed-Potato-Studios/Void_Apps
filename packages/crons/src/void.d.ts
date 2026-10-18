/**
 * Local contract for the Void Cloud runtime module (`void`).
 *
 * npm's `void` package is an unrelated CloudFront helper — the real SDK is not
 * published there. Until it is, this ambient declaration lets `crons/` job files
 * and app routes typecheck their `defineScheduled` / `defineHandler` / `voidPlugin`
 * imports, and documents the exact surface `packages/crons` detects.
 */
declare module "void" {
  /** Scheduled-event passed to cron default handlers. */
  export interface ScheduledEvent {
    /** Expression that fired, e.g. `"0 2 * * *"`. */
    cron: string;
    /** Fire time in milliseconds since epoch. */
    scheduledTime: number;
  }

  /** Wraps a cron default handler with typed scheduled-event inference. */
  export function defineScheduled<T>(handler: (event: ScheduledEvent) => T | Promise<T>): (
    event: ScheduledEvent,
  ) => Promise<T>;

  /** Wraps an HTTP route handler. */
  export function defineHandler<T>(handler: (context: { request: Request }) => T | Promise<T>): (
    context: {
      request: Request;
    },
  ) => Promise<T>;

  /** Vite plugin wiring Void routes/schedules during dev/build. */
  export function voidPlugin(): { name: string };
}
