// Rolling-window spending tracker used to enforce per-call and per-day signing
// limits in @cardano402/mcp-server.
//
// All amounts are lovelace (1 ADA = 1_000_000 lovelace). The tracker is
// process-local by default, but can persist a JSON ledger to disk so a restart
// does not reset the daily spend cap.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const STORE_LOCK_TIMEOUT_MS = 5_000;
const STORE_LOCK_RETRY_MS = 25;

export interface SpendCheckArgs {
  amount: bigint;
  payTo: string;
  asset?: string;
  txHash?: string;
  toolName?: string;
}

export interface SpendTrackerOptions {
  maxAmountPerCall: bigint;
  maxAmountPerDay: bigint;
  payToAllowlist?: string[];
  /** Window length in milliseconds. Defaults to 24h. Exposed for tests. */
  windowMs?: number;
  /** Clock override (returns ms-since-epoch). Defaults to Date.now. Tests inject. */
  now?: () => number;
  /** Optional JSON ledger path. When set, spend history persists across restarts. */
  storePath?: string;
  /** How long a pre-sign reservation counts against the cap. Defaults to 10m. */
  reservationTtlMs?: number;
  /** How long to wait for another process to release the store lock. Defaults to 5s. */
  lockTimeoutMs?: number;
}

interface SpendEntry {
  id: string;
  at: number;
  amount: bigint;
  payTo: string;
  asset: string;
  txHash?: string;
  toolName?: string;
  status: 'pending' | 'committed';
  pendingUntil?: number;
}

interface StoredSpendLedger {
  version: 1;
  entries: Array<{
    at: number;
    amount: string;
    payTo: string;
    asset?: string;
    txHash?: string;
    toolName?: string;
    id?: string;
    status?: 'pending' | 'committed';
    pendingUntil?: number;
  }>;
}

interface StoreLockHolder {
  pid: number;
  acquiredAt: number;
}

export class SpendLimitError extends Error {
  constructor(message: string, public readonly code: 'per_call' | 'per_day' | 'pay_to_allowlist') {
    super(message);
    this.name = 'SpendLimitError';
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export class SpendReservation {
  private closed = false;

  constructor(private readonly tracker: SpendTracker, public readonly id: string) {}

  commit(args: Omit<SpendCheckArgs, 'amount' | 'payTo'> = {}): void {
    if (this.closed) return;
    this.tracker.commitReservation(this.id, args);
    this.closed = true;
  }

  rollback(): void {
    if (this.closed) return;
    this.tracker.rollbackReservation(this.id);
    this.closed = true;
  }
}

/**
 * Track signed-amount spending against per-call and per-day caps.
 *
 * For signing flows, call `reserve()` before handing the amount to the signer,
 * then commit or roll back the returned reservation after the signer returns.
 * `assertCanSpend()` and `record()` remain available for callers that already
 * serialize their own check/write path.
 */
export class SpendTracker {
  private readonly maxPerCall: bigint;
  private readonly maxPerDay: bigint;
  private readonly allowlist: Set<string> | null;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly storePath?: string;
  private readonly reservationTtlMs: number;
  private readonly lockTimeoutMs: number;
  private readonly history: SpendEntry[] = [];

  constructor(options: SpendTrackerOptions) {
    this.maxPerCall = options.maxAmountPerCall;
    this.maxPerDay = options.maxAmountPerDay;
    this.allowlist =
      options.payToAllowlist && options.payToAllowlist.length > 0
        ? new Set(options.payToAllowlist)
        : null;
    this.windowMs = options.windowMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
    this.storePath = options.storePath;
    this.reservationTtlMs = options.reservationTtlMs ?? 10 * 60 * 1000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? STORE_LOCK_TIMEOUT_MS;
    if (this.storePath) {
      this.withStoreLock(() => {
        this.loadLedger();
        this.pruneExpired();
        this.persistLedger();
      });
    }
  }

  reserve(args: SpendCheckArgs): SpendReservation {
    const id = randomUUID();
    const writeReservation = (): void => {
      if (this.storePath) this.loadLedger();
      this.assertCanSpendLoaded(args);
      this.history.push({
        id,
        at: this.now(),
        amount: args.amount,
        payTo: args.payTo,
        asset: args.asset ?? 'lovelace',
        txHash: args.txHash,
        toolName: args.toolName,
        status: 'pending',
        pendingUntil: this.now() + this.reservationTtlMs,
      });
      this.pruneExpired();
      this.persistLedger();
    };
    if (this.storePath) {
      this.withStoreLock(writeReservation);
    } else {
      writeReservation();
    }
    return new SpendReservation(this, id);
  }

  /** Throws SpendLimitError if signing this amount would breach a limit. */
  assertCanSpend(args: SpendCheckArgs): void {
    const checkSpend = (): void => {
      if (this.storePath) this.loadLedger();
      this.assertCanSpendLoaded(args);
    };
    if (this.storePath) {
      this.withStoreLock(checkSpend);
    } else {
      checkSpend();
    }
  }

  private assertCanSpendLoaded(args: SpendCheckArgs): void {
    if (this.allowlist && !this.allowlist.has(args.payTo)) {
      throw new SpendLimitError(
        `payTo ${args.payTo} is not in the configured allowlist`,
        'pay_to_allowlist'
      );
    }
    if (args.amount > this.maxPerCall) {
      throw new SpendLimitError(
        `amount ${args.amount.toString()} exceeds per-call cap of ${this.maxPerCall.toString()} lovelace`,
        'per_call'
      );
    }
    const used = this.spentInWindowLoaded();
    if (used + args.amount > this.maxPerDay) {
      throw new SpendLimitError(
        `amount ${args.amount.toString()} would push 24h spend from ${used.toString()} to ${(used + args.amount).toString()}, ` +
          `over the ${this.maxPerDay.toString()} lovelace per-day cap`,
        'per_day'
      );
    }
  }

  /** Record a successful spend. Idempotent only at the entry level. */
  record(args: SpendCheckArgs): void {
    const writeRecord = (): void => {
      if (this.storePath) this.loadLedger();
      this.history.push({
        id: randomUUID(),
        at: this.now(),
        amount: args.amount,
        payTo: args.payTo,
        asset: args.asset ?? 'lovelace',
        txHash: args.txHash,
        toolName: args.toolName,
        status: 'committed',
      });
      this.pruneExpired();
      this.persistLedger();
    };
    if (this.storePath) {
      this.withStoreLock(writeRecord);
    } else {
      writeRecord();
    }
  }

  /** Total spend within the rolling window. Exposed for diagnostics + tests. */
  spentInWindow(): bigint {
    const readSpend = (): bigint => {
      if (this.storePath) this.loadLedger();
      const total = this.spentInWindowLoaded();
      this.persistLedger();
      return total;
    };
    if (this.storePath) return this.withStoreLock(readSpend);
    return readSpend();
  }

  private spentInWindowLoaded(): bigint {
    this.pruneExpired();
    let total = 0n;
    for (const entry of this.history) total += entry.amount;
    return total;
  }

  private pruneExpired(): void {
    const currentTime = this.now();
    const cutoff = currentTime - this.windowMs;
    let i = 0;
    while (i < this.history.length && this.history[i].at < cutoff) i += 1;
    if (i > 0) this.history.splice(0, i);
    for (let j = this.history.length - 1; j >= 0; j -= 1) {
      const entry = this.history[j];
      if (
        entry.status === 'pending' &&
        entry.pendingUntil !== undefined &&
        entry.pendingUntil < currentTime
      ) {
        this.history.splice(j, 1);
      }
    }
  }

  commitReservation(id: string, args: Omit<SpendCheckArgs, 'amount' | 'payTo'>): void {
    const commit = (): void => {
      if (this.storePath) this.loadLedger();
      const entry = this.history.find((item) => item.id === id && item.status === 'pending');
      if (!entry) return;
      entry.status = 'committed';
      entry.pendingUntil = undefined;
      entry.asset = args.asset ?? entry.asset;
      entry.txHash = args.txHash;
      entry.toolName = args.toolName;
      this.pruneExpired();
      this.persistLedger();
    };
    if (this.storePath) {
      this.withStoreLock(commit);
    } else {
      commit();
    }
  }

  rollbackReservation(id: string): void {
    const rollback = (): void => {
      if (this.storePath) this.loadLedger();
      const index = this.history.findIndex((entry) => entry.id === id && entry.status === 'pending');
      if (index >= 0) this.history.splice(index, 1);
      this.persistLedger();
    };
    if (this.storePath) {
      this.withStoreLock(rollback);
    } else {
      rollback();
    }
  }

  private withStoreLock<T>(operation: () => T): T {
    if (!this.storePath) return operation();
    mkdirSync(dirname(this.storePath), { recursive: true, mode: 0o700 });
    const lockPath = `${this.storePath}.lock`;
    const holderPath = `${lockPath}/holder.json`;
    const started = Date.now();
    while (true) {
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        writeFileSync(
          holderPath,
          `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() } satisfies StoreLockHolder)}\n`,
          { mode: 0o600 }
        );
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw error;
        if (this.removeStaleStoreLock(lockPath, holderPath)) continue;
        if (Date.now() - started >= this.lockTimeoutMs) {
          throw new Error(
            `Timed out waiting for spend ledger lock at ${lockPath}; remove it only after confirming no signer process is active`
          );
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STORE_LOCK_RETRY_MS);
      }
    }
    try {
      return operation();
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  }

  private removeStaleStoreLock(lockPath: string, holderPath: string): boolean {
    let holder: StoreLockHolder;
    try {
      holder = JSON.parse(readFileSync(holderPath, 'utf8')) as StoreLockHolder;
    } catch {
      return false;
    }
    if (!Number.isInteger(holder.pid) || holder.pid <= 0) return false;
    if (holder.pid === process.pid || isProcessAlive(holder.pid)) return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  }

  private loadLedger(): void {
    if (!this.storePath) return;
    this.history.splice(0, this.history.length);
    let raw: string;
    try {
      raw = readFileSync(this.storePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw error;
    }

    const parsed = JSON.parse(raw) as StoredSpendLedger;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error(`Unsupported spend ledger format at ${this.storePath}`);
    }

    for (const entry of parsed.entries) {
      if (!Number.isFinite(entry.at) || entry.at < 0) continue;
      const amount = BigInt(entry.amount);
      if (amount < 0n) continue;
      this.history.push({
        id: entry.id ?? randomUUID(),
        at: entry.at,
        amount,
        payTo: entry.payTo,
        asset: entry.asset ?? 'lovelace',
        txHash: entry.txHash,
        toolName: entry.toolName,
        status: entry.status ?? 'committed',
        pendingUntil: entry.pendingUntil,
      });
    }
  }

  private persistLedger(): void {
    if (!this.storePath) return;
    mkdirSync(dirname(this.storePath), { recursive: true, mode: 0o700 });
    const ledger: StoredSpendLedger = {
      version: 1,
      entries: this.history.map((entry) => ({
        at: entry.at,
        amount: entry.amount.toString(),
        payTo: entry.payTo,
        asset: entry.asset,
        txHash: entry.txHash,
        toolName: entry.toolName,
        id: entry.id,
        status: entry.status,
        pendingUntil: entry.pendingUntil,
      })),
    };
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.storePath);
  }
}
