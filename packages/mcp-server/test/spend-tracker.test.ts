import { describe, it, expect } from 'vitest';

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
});
