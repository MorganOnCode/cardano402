import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

// Exercise the actual RPC boundary: x402 response types allow unknown extension
// fields, so the executor returns JSON rather than non-serializable RPC types.
const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'cardano:preview',
  amount: '2000000',
  asset: 'lovelace',
  payTo: 'addr_test1vz0000000000000000000000000000000000000000000000000000',
  maxTimeoutSeconds: 300,
  extra: {},
};
const payload: PaymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: { transaction: 'bm90LWNib3I=', nonce: '00' },
};

beforeAll(async () => {
  const stub = env.EXECUTOR.get(env.EXECUTOR.idFromName('rpc-warmup'));
  await stub.verify(payload, requirements);
}, 120_000);

describe('Durable Object payment execution', () => {
  it('preserves verification and settlement rejection through RPC without broadcasting', async () => {
    const stub = env.EXECUTOR.get(env.EXECUTOR.idFromName('rpc-test'));
    expect(JSON.parse(await stub.verify(payload, requirements))).toMatchObject({ isValid: false });
    expect(JSON.parse(await stub.settle(payload, requirements))).toMatchObject({ success: false });
  });
});
