import { describe, it, expect, vi } from 'vitest';

import type { CatalogEndpoint } from '../src/catalog.js';
import { payAndFetch } from '../src/payment.js';
import type { CardanoSigner, SignPaymentArgs, SignedPayment } from '../src/signer.js';
import { SpendTracker, SpendLimitError } from '../src/spend-tracker.js';

const SIGNED_TX_CBOR_BASE64 = Buffer.from('deadbeef', 'hex').toString('base64');
const TX_HASH = 'a'.repeat(64);
const NONCE = `${TX_HASH}#0`;

const ENDPOINT: CatalogEndpoint = {
  method: 'POST',
  path: '/api/analyze',
  scheme: 'exact',
  network: 'cardano:preview',
  amount: '6000000', // > default 5_000_000 per-call cap
  asset: 'lovelace',
  payTo: 'addr_test1qx2fxv2',
  maxTimeoutSeconds: 600,
  description: 'analyse',
};

function makeStubSigner(): { signer: CardanoSigner; signPayment: ReturnType<typeof vi.fn> } {
  const signPayment = vi.fn(
    async (_args: SignPaymentArgs): Promise<SignedPayment> => ({
      cborBase64: SIGNED_TX_CBOR_BASE64,
      nonce: NONCE,
      txHash: TX_HASH,
    })
  );
  const signer: CardanoSigner = {
    address: async () => 'addr_test1qx2sender',
    signPayment,
  };
  return { signer, signPayment };
}

function paymentRequiredHeader(endpoint: CatalogEndpoint = ENDPOINT): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      error: null,
      resource: { description: 'x', mimeType: 'application/json', url: '/api/analyze' },
      accepts: [
        {
          scheme: 'exact',
          network: endpoint.network,
          amount: endpoint.amount,
          payTo: endpoint.payTo,
          maxTimeoutSeconds: endpoint.maxTimeoutSeconds,
          asset: endpoint.asset,
          extra: null,
        },
      ],
    })
  ).toString('base64');
}

function make402Then200(endpoint: CatalogEndpoint = ENDPOINT): ReturnType<typeof vi.fn> {
  let n = 0;
  return vi.fn(async () => {
    n += 1;
    if (n === 1) {
      return new Response(null, {
        status: 402,
        headers: { 'payment-required': paymentRequiredHeader(endpoint) },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('payAndFetch — spending limit gates', () => {
  it('refuses to sign when amount exceeds the per-call cap', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = make402Then200();
    const tracker = new SpendTracker({
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
    });
    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint: ENDPOINT,
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        spendTracker: tracker,
      })
    ).rejects.toBeInstanceOf(SpendLimitError);
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('refuses to sign when 24h spend would exceed the per-day cap', async () => {
    const { signer, signPayment } = makeStubSigner();
    const endpoint = { ...ENDPOINT, amount: '1' };
    const fetchImpl = make402Then200(endpoint);
    const tracker = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 5_000_000n,
    });
    // Pre-fill with a recorded spend so the per-day cap is at-limit.
    tracker.record({ amount: 5_000_000n, payTo: ENDPOINT.payTo });
    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint,
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        spendTracker: tracker,
      })
    ).rejects.toBeInstanceOf(SpendLimitError);
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('refuses to sign when payTo is not in the allowlist', async () => {
    const { signer, signPayment } = makeStubSigner();
    const endpoint = { ...ENDPOINT, amount: '1' };
    const fetchImpl = make402Then200(endpoint);
    const tracker = new SpendTracker({
      maxAmountPerCall: 50_000_000n,
      maxAmountPerDay: 50_000_000n,
      payToAllowlist: ['addr_known_good'],
    });
    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint,
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        spendTracker: tracker,
      })
    ).rejects.toBeInstanceOf(SpendLimitError);
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('records the spend after a successful sign', async () => {
    const { signer, signPayment } = makeStubSigner();
    const endpoint = { ...ENDPOINT, amount: '1000000' };
    const fetchImpl = make402Then200(endpoint);
    const tracker = new SpendTracker({
      maxAmountPerCall: 10_000_000n,
      maxAmountPerDay: 50_000_000n,
    });
    await payAndFetch({
      baseUrl: 'https://api.example.com',
      endpoint,
      signer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spendTracker: tracker,
    });
    expect(signPayment).toHaveBeenCalledOnce();
    expect(tracker.spentInWindow()).toBe(1_000_000n);
  });
});

describe('payAndFetch — elicitation gate', () => {
  it('declines a signing when the elicit callback returns false', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = make402Then200();
    const elicit = vi.fn(async () => false);
    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint: { ...ENDPOINT, amount: '6000000' },
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        elicit,
        elicitationThreshold: 5_000_000n,
      })
    ).rejects.toThrow(/declined/);
    expect(elicit).toHaveBeenCalledOnce();
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('does NOT consult the elicit callback for amounts at or under the threshold', async () => {
    const { signer, signPayment } = makeStubSigner();
    const endpoint = { ...ENDPOINT, amount: '5000000' };
    const fetchImpl = make402Then200(endpoint);
    const elicit = vi.fn(async () => true);
    await payAndFetch({
      baseUrl: 'https://api.example.com',
      endpoint,
      signer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      elicit,
      elicitationThreshold: 5_000_000n,
    });
    expect(elicit).not.toHaveBeenCalled();
    expect(signPayment).toHaveBeenCalledOnce();
  });

  it('proceeds with signing when elicit returns true', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = make402Then200();
    const elicit = vi.fn(async () => true);
    await payAndFetch({
      baseUrl: 'https://api.example.com',
      endpoint: { ...ENDPOINT, amount: '6000000' },
      signer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      elicit,
      elicitationThreshold: 5_000_000n,
    });
    expect(elicit).toHaveBeenCalledOnce();
    expect(signPayment).toHaveBeenCalledOnce();
  });
});
