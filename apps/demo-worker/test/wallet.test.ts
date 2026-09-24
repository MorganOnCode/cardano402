import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { DAILY_RUNS, NETWORK, requirements } from '../src/policy';

function wallet() {
  return env.WALLET.get(env.WALLET.idFromName(crypto.randomUUID()));
}
async function seed(s: ReturnType<typeof wallet>, run: Record<string, unknown>) {
  await runInDurableObject(s, async (_instance, state) => {
    await state.storage.put('run', run);
  });
}
const pending = (transaction = 'persisted-signed-bytes') => ({
  started: Date.now(),
  state: 'pending',
  attempts: 0,
  message: 'pending',
  payload: { payload: { transaction } },
  requirements: { payTo: 'addr_test1fixture' },
});

describe('funded test wallet isolation and limits', () => {
  it('fixes a self-payment amount and testnet network; rejects mainnet recipients', () => {
    const terms = requirements('addr_test1fixture');
    expect(terms).toMatchObject({
      network: NETWORK,
      amount: '2000000',
      payTo: 'addr_test1fixture',
    });
    expect(() => requirements('addr1mainnet')).toThrow();
  });
  it('resumes persisted signed bytes after restart instead of signing again', async () => {
    const s = wallet();
    await seed(s, pending());
    const response = await s.fetch('https://test/run', { method: 'POST' });
    expect(await response.json()).toMatchObject({
      state: 'confirmed',
      transaction: 'a'.repeat(64),
    });
    await runInDurableObject(s, async (_instance, state) => {
      const run = await state.storage.get<{ payload?: unknown; attempts: number }>('run');
      expect(run?.payload).toBeUndefined();
      expect(run?.attempts).toBe(1);
    });
  });
  it('coalesces concurrent visitors and reuses a recent confirmed receipt', async () => {
    const s = wallet();
    await seed(s, pending());
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => s.fetch('https://test/run', { method: 'POST' }))
    );
    for (const response of responses)
      expect(await response.json()).toMatchObject({ state: 'confirmed' });
    expect(await (await s.fetch('https://test/run')).json()).toMatchObject({
      cached: true,
      state: 'confirmed',
    });
    await runInDurableObject(s, async (_instance, state) => {
      expect((await state.storage.get<{ attempts: number }>('run'))?.attempts).toBe(1);
    });
  });
  it('never replaces an unresolved transaction, even after the cooldown', async () => {
    const s = wallet();
    await seed(s, { ...pending('still-pending'), started: Date.now() - 86_400_000 });
    for (let n = 0; n < 4; n++) expect((await s.fetch('https://test/run')).status).toBe(202);
    await runInDurableObject(s, async (_instance, state) => {
      expect(await state.storage.get('run')).toMatchObject({
        state: 'pending',
        attempts: 2,
        payload: { payload: { transaction: 'still-pending' } },
      });
    });
  });
  it('refuses a sixth daily run before reading the signer or provider', async () => {
    const s = wallet();
    await runInDurableObject(s, async (_instance, state) => {
      await state.storage.put('quota', {
        day: Math.floor(Date.now() / 86_400_000),
        used: DAILY_RUNS,
      });
    });
    expect((await s.fetch('https://test/run')).status).toBe(429);
  });
  it('has no periodic alarms or background polling', async () => {
    const s = wallet();
    await seed(s, pending());
    await s.fetch('https://test/run');
    await runInDurableObject(s, async (_instance, state) =>
      expect(await state.storage.getAlarm()).toBeNull()
    );
  });
});
