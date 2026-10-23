/**
 * Native Void durable-state coordination. The consuming app provides the
 * `defineDurableState` method/store; this module only performs short,
 * serialized state transitions and runs business work outside them.
 */
export interface CronCoordinationStateStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  setAlarm?(at: number): Promise<void>;
}

export interface CronLease {
  id: string;
  jobName: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface CronCoordinatorOptions {
  store: CronCoordinationStateStore;
  now?: () => number;
  createId?: () => string;
}

export interface CronLeaseResult<Result> {
  ran: boolean;
  lease?: CronLease;
  result?: Result;
  reason?: "paused" | "pause-unavailable" | "lease-held" | "coordination-unavailable";
}

export interface CronCoordinator {
  acquire(jobName: string, owner: string, ttlMs: number): Promise<CronLease | null>;
  renew(jobName: string, leaseId: string, ttlMs: number): Promise<CronLease | null>;
  release(jobName: string, leaseId: string): Promise<boolean>;
  expire(jobName: string, at?: number): Promise<boolean>;
  handleAlarm(jobNames: readonly string[], at?: number): Promise<string[]>;
  isPaused(jobName: string): Promise<boolean>;
  setPaused(jobName: string, paused: boolean): Promise<void>;
  withLease<Result>(
    jobName: string,
    owner: string,
    ttlMs: number,
    work: () => Result | Promise<Result>,
  ): Promise<CronLeaseResult<Awaited<Result>>>;
}

const LEASE_PREFIX = "cron:lease:";
const PAUSE_PREFIX = "cron:pause:";

function leaseKey(jobName: string): string {
  return `${LEASE_PREFIX}${jobName}`;
}

function pauseKey(jobName: string): string {
  return `${PAUSE_PREFIX}${jobName}`;
}

function assertTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("lease ttl must be a positive finite number");
  return Math.floor(ttlMs);
}

/**
 * Create a coordinator over an app-owned durable-state store. Call these
 * methods from the serialized durable-state context; they never run the job
 * body inside a state transition.
 */
export function createCronCoordinator(options: CronCoordinatorOptions): CronCoordinator {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };

  const acquire = (jobName: string, owner: string, ttlMs: number): Promise<CronLease | null> => serialized(async () => {
    const ttl = assertTtl(ttlMs);
    const at = now();
    const existing = await options.store.get<CronLease>(leaseKey(jobName));
    if (existing && existing.expiresAt > at) return null;
    const lease: CronLease = {
      id: createId(),
      jobName,
      owner,
      acquiredAt: at,
      expiresAt: at + ttl,
    };
    await options.store.put(leaseKey(jobName), lease);
    if (options.store.setAlarm) {
      try {
        await options.store.setAlarm(lease.expiresAt);
      } catch (error) {
        try {
          await options.store.delete(leaseKey(jobName));
        } catch {}
        throw error;
      }
    }
    return lease;
  });

  const renew = (jobName: string, leaseId: string, ttlMs: number): Promise<CronLease | null> => serialized(async () => {
    const ttl = assertTtl(ttlMs);
    const at = now();
    const existing = await options.store.get<CronLease>(leaseKey(jobName));
    if (!existing || existing.id !== leaseId || existing.expiresAt <= at) return null;
    const renewed: CronLease = { ...existing, expiresAt: at + ttl };
    await options.store.put(leaseKey(jobName), renewed);
    await options.store.setAlarm?.(renewed.expiresAt);
    return renewed;
  });

  const release = (jobName: string, leaseId: string): Promise<boolean> => serialized(async () => {
    const existing = await options.store.get<CronLease>(leaseKey(jobName));
    if (!existing || existing.id !== leaseId) return false;
    await options.store.delete(leaseKey(jobName));
    return true;
  });

  const expire = (jobName: string, at = now()): Promise<boolean> => serialized(async () => {
    const existing = await options.store.get<CronLease>(leaseKey(jobName));
    if (!existing || existing.expiresAt > at) return false;
    await options.store.delete(leaseKey(jobName));
    return true;
  });

  const handleAlarm = async (jobNames: readonly string[], at = now()): Promise<string[]> => {
    const expired: string[] = [];
    for (const jobName of jobNames) {
      if (await expire(jobName, at)) expired.push(jobName);
    }
    return expired;
  };

  const isPaused = async (jobName: string): Promise<boolean> => {
    return (await options.store.get<boolean>(pauseKey(jobName))) === true;
  };

  const setPaused = (jobName: string, paused: boolean): Promise<void> => serialized(async () => {
    await options.store.put(pauseKey(jobName), paused);
  });

  const withLease = async <Result>(
    jobName: string,
    owner: string,
    ttlMs: number,
    work: () => Result | Promise<Result>,
  ): Promise<CronLeaseResult<Awaited<Result>>> => {
    let paused: boolean;
    try {
      paused = await isPaused(jobName);
    } catch {
      return { ran: false, reason: "pause-unavailable" };
    }
    if (paused) return { ran: false, reason: "paused" };

    let lease: CronLease | null;
    try {
      lease = await acquire(jobName, owner, ttlMs);
    } catch {
      return { ran: false, reason: "coordination-unavailable" };
    }
    if (!lease) return { ran: false, reason: "lease-held" };

    try {
      const result = await work();
      return { ran: true, lease, result };
    } finally {
      try {
        await release(jobName, lease.id);
      } catch {}
    }
  };

  return { acquire, renew, release, expire, handleAlarm, isPaused, setPaused, withLease };
}
