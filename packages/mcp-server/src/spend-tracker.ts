// In-memory rolling-window spending tracker used to enforce per-call and
// per-day signing limits in @cardano402/mcp-server.
//
// All amounts are lovelace (1 ADA = 1_000_000 lovelace). The tracker is
// process-local — it intentionally does NOT persist across restarts, so a
// crashed/restarted MCP server starts from a fresh budget. The audit
// considered persistent forensics out of scope for 0.1.2.

export interface SpendCheckArgs {
  amount: bigint;
  payTo: string;
}

export interface SpendTrackerOptions {
  maxAmountPerCall: bigint;
  maxAmountPerDay: bigint;
  payToAllowlist?: string[];
  /** Window length in milliseconds. Defaults to 24h. Exposed for tests. */
  windowMs?: number;
  /** Clock override (returns ms-since-epoch). Defaults to Date.now. Tests inject. */
  now?: () => number;
}

interface SpendEntry {
  at: number;
  amount: bigint;
}

export class SpendLimitError extends Error {
  constructor(message: string, public readonly code: 'per_call' | 'per_day' | 'pay_to_allowlist') {
    super(message);
    this.name = 'SpendLimitError';
  }
}

/**
 * Track signed-amount spending against per-call and per-day caps.
 *
 * Call `assertCanSpend()` BEFORE handing the amount to the signer. Call
 * `record()` only after the signer returns successfully — that way a failed
 * sign doesn't burn budget against subsequent attempts.
 */
export class SpendTracker {
  private readonly maxPerCall: bigint;
  private readonly maxPerDay: bigint;
  private readonly allowlist: Set<string> | null;
  private readonly windowMs: number;
  private readonly now: () => number;
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
  }

  /** Throws SpendLimitError if signing this amount would breach a limit. */
  assertCanSpend(args: SpendCheckArgs): void {
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
    const used = this.spentInWindow();
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
    this.history.push({ at: this.now(), amount: args.amount });
  }

  /** Total spend within the rolling window. Exposed for diagnostics + tests. */
  spentInWindow(): bigint {
    const cutoff = this.now() - this.windowMs;
    let i = 0;
    while (i < this.history.length && this.history[i].at < cutoff) i += 1;
    if (i > 0) this.history.splice(0, i);
    let total = 0n;
    for (const entry of this.history) total += entry.amount;
    return total;
  }
}
