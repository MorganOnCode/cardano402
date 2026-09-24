import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { RETENTION_MS, STALE_IN_FLIGHT_MS, type SettlementStore } from '../src/settlement-store';

const tx = (n: number) => n.toString(16).padStart(64, '0');

function store(name = crypto.randomUUID()) {
  return env.SETTLEMENTS.get(env.SETTLEMENTS.idFromName(name));
}

describe('SettlementStore', () => {
  it('claims a new transaction once, then reports it in flight', async () => {
    const s = store();
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' })).toBe('fresh');
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('in-flight');
  });

  it('resumes a submitted transaction instead of broadcasting again', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await s.markSubmitted(tx(1), 'a');
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('submitted');
  });

  it('keeps a rejection tombstone', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await s.markRejected(tx(1), 'a');
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('rejected');
  });

  it('ignores state changes from a non-owner', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await s.markSubmitted(tx(1), 'intruder');
    await s.releaseClaim(tx(1), 'intruder');
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('in-flight');
  });

  it('releases an owned in-flight claim so a later attempt starts over', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a', termsDigest: 'T' });
    await s.releaseClaim(tx(1), 'a');
    expect(await s.claimSettlement({ txHash: tx(2), ownerToken: 'b', termsDigest: 'T' })).toBe(
      'fresh'
    );
  });

  it('does not release a claim that was already submitted', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await s.markSubmitted(tx(1), 'a');
    await s.releaseClaim(tx(1), 'a');
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('submitted');
  });

  it('binds a Masumi terms digest to exactly one transaction', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a', termsDigest: 'T' });
    expect(await s.claimSettlement({ txHash: tx(2), ownerToken: 'b', termsDigest: 'T' })).toBe(
      'terms-conflict'
    );
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b', termsDigest: 'U' })).toBe(
      'terms-conflict'
    );
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('terms-conflict');
  });

  it('treats a stale in-flight claim as submitted so it is observed, never re-broadcast', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await runInDurableObject(s, (_i: SettlementStore, state) => {
      state.storage.sql.exec(
        'UPDATE submissions SET claimed_at = ?',
        Date.now() - STALE_IN_FLIGHT_MS - 1
      );
    });
    expect(await s.claimSettlement({ txHash: tx(1), ownerToken: 'b' })).toBe('submitted');
  });

  it('sweeps settled records after retention but keeps tombstones and in-flight claims', async () => {
    const s = store();
    for (const n of [1, 2, 3]) await s.claimSettlement({ txHash: tx(n), ownerToken: 'a' });
    await s.markSubmitted(tx(1), 'a');
    await s.markRejected(tx(2), 'a');
    await runInDurableObject(s, (_i: SettlementStore, state) => {
      state.storage.sql.exec(
        'UPDATE submissions SET updated_at = ?',
        Date.now() - RETENTION_MS - 1
      );
    });
    expect(await runDurableObjectAlarm(s)).toBe(true);
    expect(await s.stats()).toEqual({ in_flight: 1, submitted: 0, rejected: 1 });
  });
});

describe('idle costs and shared quotas', () => {
  it('does not schedule cleanup for records that cannot expire', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await s.markRejected(tx(1), 'a');
    await runInDurableObject(s, async (_i, state) =>
      expect(await state.storage.getAlarm()).toBeNull()
    );
  });
  it('stops cleanup after the final submitted record expires and restarts for new submissions', async () => {
    const s = store();
    await s.claimSettlement({ txHash: tx(1), ownerToken: 'a' });
    await s.markSubmitted(tx(1), 'a');
    await runInDurableObject(s, (_i, state) => {
      state.storage.sql.exec(
        'UPDATE submissions SET updated_at = ?',
        Date.now() - RETENTION_MS - 1
      );
    });
    expect(await runDurableObjectAlarm(s)).toBe(true);
    await runInDurableObject(s, async (_i, state) =>
      expect(await state.storage.getAlarm()).toBeNull()
    );
    await s.claimSettlement({ txHash: tx(2), ownerToken: 'b' });
    await s.markSubmitted(tx(2), 'b');
    await runInDurableObject(s, async (_i, state) =>
      expect(await state.storage.getAlarm()).not.toBeNull()
    );
  });
  it('enforces a global quota atomically across concurrent calls and resets next UTC day', async () => {
    const s = store();
    const results = await Promise.all(Array.from({ length: 12 }, () => s.takeBudget('probe')));
    expect(results.filter(Boolean)).toHaveLength(4);
    await runInDurableObject(s, (_i, state) =>
      state.storage.sql.exec('UPDATE budgets SET day = day - 1')
    );
    expect(await s.takeBudget('probe')).toBe(true);
  });
});
