import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpendLimitError, SpendTracker } from '../src/spend-tracker.js';

describe('SpendTracker', () => {
  it('passes amounts that are under both caps', () => {
    const t = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
    });
    expect(() => t.assertCanSpend({ amount: 2_000_000n, payTo: 'addr1' })).not.toThrow();
  });

  it('rejects an amount above the per-call cap', () => {
    const t = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
    });
    try {
      t.assertCanSpend({ amount: 6_000_000n, payTo: 'addr1' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendLimitError);
      expect((err as SpendLimitError).code).toBe('per_call');
    }
  });

  it('rejects when the rolling 24h window would exceed the per-day cap', () => {
    const now = { v: 1_000_000 };
    const t = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 10_000_000n,
      now: () => now.v,
    });
    t.record({ amount: 4_000_000n, payTo: 'addr1' });
    t.record({ amount: 4_000_000n, payTo: 'addr1' });
    try {
      t.assertCanSpend({ amount: 4_000_000n, payTo: 'addr1' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendLimitError);
      expect((err as SpendLimitError).code).toBe('per_day');
    }
  });

  it('expires entries that fall outside the rolling window', () => {
    const now = { v: 0 };
    const t = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 10_000_000n,
      windowMs: 1000,
      now: () => now.v,
    });
    t.record({ amount: 4_000_000n, payTo: 'addr1' });
    t.record({ amount: 4_000_000n, payTo: 'addr1' });
    expect(t.spentInWindow()).toBe(8_000_000n);
    now.v = 2000; // both entries older than 1000ms window
    expect(t.spentInWindow()).toBe(0n);
    expect(() => t.assertCanSpend({ amount: 5_000_000n, payTo: 'addr1' })).not.toThrow();
  });

  it('rejects payTo not in the allowlist', () => {
    const t = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      payToAllowlist: ['addr_allowed_1', 'addr_allowed_2'],
    });
    try {
      t.assertCanSpend({ amount: 1_000_000n, payTo: 'addr_attacker' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendLimitError);
      expect((err as SpendLimitError).code).toBe('pay_to_allowlist');
    }
    expect(() =>
      t.assertCanSpend({ amount: 1_000_000n, payTo: 'addr_allowed_1' })
    ).not.toThrow();
  });

  it('records nothing when assertCanSpend throws — failed signs do not burn budget', () => {
    const t = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 5_000_000n,
    });
    expect(() => t.assertCanSpend({ amount: 6_000_000n, payTo: 'addr' })).toThrow();
    expect(t.spentInWindow()).toBe(0n);
    expect(() => t.assertCanSpend({ amount: 5_000_000n, payTo: 'addr' })).not.toThrow();
  });

  it('persists spend history across tracker restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-'));
    const storePath = join(dir, 'ledger.json');

    const first = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_000,
    });
    first.record({
      amount: 4_000_000n,
      payTo: 'addr1',
      asset: 'lovelace',
      txHash: 'a'.repeat(64),
      toolName: 'post_api_analyze',
    });

    const stored = JSON.parse(readFileSync(storePath, 'utf8')) as {
      entries: Array<{ amount: string; txHash?: string; toolName?: string }>;
    };
    expect(stored.entries[0]).toMatchObject({
      amount: '4000000',
      txHash: 'a'.repeat(64),
      toolName: 'post_api_analyze',
    });

    const second = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_001,
    });
    expect(second.spentInWindow()).toBe(4_000_000n);
    expect(() => second.assertCanSpend({ amount: 2_000_000n, payTo: 'addr1' })).toThrow(
      SpendLimitError
    );
  });

  it('reloads persistent spend history before checking a long-lived tracker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-reload-'));
    const storePath = join(dir, 'ledger.json');

    const first = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_000,
    });
    const second = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_001,
    });

    first.record({ amount: 4_000_000n, payTo: 'addr1' });

    expect(() => second.assertCanSpend({ amount: 2_000_000n, payTo: 'addr1' })).toThrow(
      SpendLimitError
    );
  });

  it('counts persistent pending reservations against the daily cap across trackers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-reserve-'));
    const storePath = join(dir, 'ledger.json');

    const first = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_000,
    });
    const reservation = first.reserve({ amount: 4_000_000n, payTo: 'addr1' });

    const second = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_001,
    });
    expect(() => second.reserve({ amount: 2_000_000n, payTo: 'addr1' })).toThrow(
      SpendLimitError
    );

    reservation.commit({ txHash: 'b'.repeat(64), toolName: 'post_api_analyze' });

    const stored = JSON.parse(readFileSync(storePath, 'utf8')) as {
      entries: Array<{ status?: string; txHash?: string; toolName?: string }>;
    };
    expect(stored.entries[0]).toMatchObject({
      status: 'committed',
      txHash: 'b'.repeat(64),
      toolName: 'post_api_analyze',
    });
  });

  it('rolls back persistent reservations when signing fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-rollback-'));
    const storePath = join(dir, 'ledger.json');

    const tracker = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_000,
    });
    const reservation = tracker.reserve({ amount: 4_000_000n, payTo: 'addr1' });
    reservation.rollback();

    const reloaded = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      now: () => 1_000_001,
    });
    expect(reloaded.spentInWindow()).toBe(0n);
    expect(() => reloaded.reserve({ amount: 5_000_000n, payTo: 'addr1' })).not.toThrow();
  });

  it('expires abandoned pending reservations after the reservation TTL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-expire-'));
    const storePath = join(dir, 'ledger.json');
    const now = { v: 1_000_000 };

    const tracker = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      reservationTtlMs: 1000,
      now: () => now.v,
    });
    tracker.reserve({ amount: 4_000_000n, payTo: 'addr1' });
    expect(tracker.spentInWindow()).toBe(4_000_000n);

    now.v = 1_002_000;
    expect(tracker.spentInWindow()).toBe(0n);
    expect(() => tracker.reserve({ amount: 5_000_000n, payTo: 'addr1' })).not.toThrow();
  });

  it('fails closed when another process holds the persistent ledger lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-lock-'));
    const storePath = join(dir, 'ledger.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(lockPath, { mode: 0o700 });
    writeFileSync(
      join(lockPath, 'holder.json'),
      `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`,
      { mode: 0o600 }
    );

    expect(
      () =>
        new SpendTracker({
          maxAmountPerCall: 10_000_000n,
          maxAmountPerDay: 5_000_000n,
          storePath,
          lockTimeoutMs: 0,
        })
    ).toThrow(/Timed out waiting for spend ledger lock/);
  });

  it('recovers a persistent ledger lock held by a dead process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-spend-stale-lock-'));
    const storePath = join(dir, 'ledger.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(lockPath, { mode: 0o700 });
    writeFileSync(
      join(lockPath, 'holder.json'),
      `${JSON.stringify({ pid: 999_999_999, acquiredAt: Date.now() })}\n`,
      { mode: 0o600 }
    );

    const tracker = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
      storePath,
      lockTimeoutMs: 0,
    });

    expect(() => tracker.reserve({ amount: 5_000_000n, payTo: 'addr1' })).not.toThrow();
    expect(tracker.spentInWindow()).toBe(5_000_000n);
  });
});
