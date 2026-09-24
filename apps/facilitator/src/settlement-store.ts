// Durable Object backing the @x402/cardano duplicate-settlement guard.
//
// Same state machine as the reference InMemoryCardanoSettlementStore, but
// durable and shared by every isolate: one transaction is broadcast at most
// once, a retry resumes observation, and a Masumi termsDigest binds to exactly
// one transaction. A single named instance serialises every claim, which is
// what makes claimSettlement atomic.
//
// Two deliberate differences from the in-memory reference:
//  - No capacity eviction. Settled records expire after RETENTION_MS instead,
//    swept by an alarm, so "capacity-exceeded" is never returned.
//  - A claim left in flight for longer than STALE_IN_FLIGHT_MS (the isolate
//    died between claim and markSubmitted) is reported as "submitted". The
//    facilitator then resumes observation rather than broadcasting again: if
//    the bytes never reached the chain, it reports a terminal failure once the
//    validity window closes, and the payer retries with a fresh transaction.
//    Never re-broadcasting is the invariant; a stuck claim must not block it.

import { DurableObject } from 'cloudflare:workers';
import type {
  CardanoSettlementClaim,
  CardanoSettlementClaimResult,
  CardanoSettlementStore,
} from '@x402/cardano';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_IN_FLIGHT_MS = 10 * 60 * 1000;
export const DAILY_LIMITS = { payment: 100, provider: 1000, probe: 4 } as const;

type Row = {
  tx_hash: string;
  owner_token: string;
  terms_digest: string | null;
  state: 'in_flight' | 'submitted' | 'rejected';
  claimed_at: number;
};

export class SettlementStore extends DurableObject<CloudflareBindings> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS budgets (kind TEXT PRIMARY KEY, day INTEGER NOT NULL, used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS submissions (
        tx_hash      TEXT PRIMARY KEY,
        owner_token  TEXT NOT NULL,
        terms_digest TEXT,
        state        TEXT NOT NULL,
        claimed_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS submissions_terms
        ON submissions(terms_digest) WHERE terms_digest IS NOT NULL;
    `);
  }

  private row(txHash: string): Row | undefined {
    return this.sql
      .exec<Row>(
        'SELECT tx_hash, owner_token, terms_digest, state, claimed_at FROM submissions WHERE tx_hash = ?',
        txHash
      )
      .toArray()[0];
  }

  async claimSettlement(claim: CardanoSettlementClaim): Promise<CardanoSettlementClaimResult> {
    const terms = claim.termsDigest ?? null;
    if (terms !== null) {
      const bound = this.sql
        .exec<{ tx_hash: string }>('SELECT tx_hash FROM submissions WHERE terms_digest = ?', terms)
        .toArray()[0];
      if (bound && bound.tx_hash !== claim.txHash) return 'terms-conflict';
    }

    const existing = this.row(claim.txHash);
    if (existing) {
      if (existing.terms_digest !== terms) return 'terms-conflict';
      if (existing.state === 'rejected') return 'rejected';
      if (existing.state === 'submitted') return 'submitted';
      return Date.now() - existing.claimed_at > STALE_IN_FLIGHT_MS ? 'submitted' : 'in-flight';
    }

    const now = Date.now();
    this.sql.exec(
      `INSERT INTO submissions (tx_hash, owner_token, terms_digest, state, claimed_at, updated_at)
       VALUES (?, ?, ?, 'in_flight', ?, ?)`,
      claim.txHash,
      claim.ownerToken,
      terms,
      now,
      now
    );
    return 'fresh';
  }

  async markSubmitted(txHash: string, ownerToken: string): Promise<void> {
    this.sql.exec(
      `UPDATE submissions SET state = 'submitted', updated_at = ? WHERE tx_hash = ? AND owner_token = ?`,
      Date.now(),
      txHash,
      ownerToken
    );
    await this.ensureSweep();
  }

  async markRejected(txHash: string, ownerToken: string): Promise<void> {
    this.sql.exec(
      `UPDATE submissions SET state = 'rejected', updated_at = ? WHERE tx_hash = ? AND owner_token = ?`,
      Date.now(),
      txHash,
      ownerToken
    );
  }

  async releaseClaim(txHash: string, ownerToken: string): Promise<void> {
    this.sql.exec(
      `DELETE FROM submissions WHERE tx_hash = ? AND owner_token = ? AND state = 'in_flight'`,
      txHash,
      ownerToken
    );
  }

  /** Aggregate counts for /health; never exposes transaction ids. */
  async stats(): Promise<Record<Row['state'], number>> {
    const counts = { in_flight: 0, submitted: 0, rejected: 0 };
    for (const r of this.sql
      .exec<{ state: Row['state']; n: number }>(
        'SELECT state, COUNT(*) AS n FROM submissions GROUP BY state'
      )
      .toArray()) {
      counts[r.state] = r.n;
    }
    return counts;
  }

  async alarm(): Promise<void> {
    // Rejections are tombstones the spec says to keep; in-flight rows are
    // kept until they resolve. Only settled records age out.
    this.sql.exec(
      `DELETE FROM submissions WHERE state = 'submitted' AND updated_at < ?`,
      Date.now() - RETENTION_MS
    );
    await this.ensureSweep();
  }

  /** Atomic, account-wide daily caps. Limits are server-owned, never supplied by callers. */
  async takeBudget(kind: keyof typeof DAILY_LIMITS): Promise<boolean> {
    if (!(kind in DAILY_LIMITS)) return false;
    const day = Math.floor(Date.now() / 86_400_000);
    const row = this.sql
      .exec<{ used: number }>(
        `INSERT INTO budgets(kind, day, used) VALUES (?, ?, 1)
       ON CONFLICT(kind) DO UPDATE SET day = excluded.day,
       used = CASE WHEN budgets.day = excluded.day THEN budgets.used + 1 ELSE 1 END
       WHERE budgets.day != excluded.day OR budgets.used < ? RETURNING used`,
        kind,
        day,
        DAILY_LIMITS[kind]
      )
      .toArray();
    return row.length === 1;
  }

  private async ensureSweep(): Promise<void> {
    const next = this.sql
      .exec<{ next: number | null }>(
        "SELECT MIN(updated_at) AS next FROM submissions WHERE state = 'submitted'"
      )
      .one().next;
    // In-flight records and rejection tombstones must be retained; waking
    // repeatedly cannot clean them. Only schedule for an expirable record.
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next + RETENTION_MS + 1));
    }
  }
}

/** Adapts the Durable Object stub to the interface @x402/cardano expects. */
export function durableSettlementStore(
  ns: DurableObjectNamespace<SettlementStore>
): CardanoSettlementStore {
  const stub = () => ns.get(ns.idFromName('global'));
  return {
    claimSettlement: (claim) => stub().claimSettlement(claim),
    markSubmitted: (txHash, ownerToken) => stub().markSubmitted(txHash, ownerToken),
    markRejected: (txHash, ownerToken) => stub().markRejected(txHash, ownerToken),
    releaseClaim: (txHash, ownerToken) => stub().releaseClaim(txHash, ownerToken),
  };
}
