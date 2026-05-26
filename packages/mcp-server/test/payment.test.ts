import { describe, it, expect, vi } from 'vitest';

import { Cardano402ValidationError, MAX_PAYMENT_HEADER_LENGTH } from '@cardano402/core';

import type { CatalogEndpoint } from '../src/catalog.js';
import { payAndFetch } from '../src/payment.js';
import type { CardanoSigner, SignPaymentArgs, SignedPayment } from '../src/signer.js';

const SIGNED_TX_CBOR_BASE64 = Buffer.from('deadbeef', 'hex').toString('base64');
const TX_HASH = 'a'.repeat(64);
const NONCE = `${TX_HASH}#0`;

const STUB_ENDPOINT: CatalogEndpoint = {
  method: 'POST',
  path: '/api/analyze',
  scheme: 'exact',
  network: 'cardano:preview',
  amount: '2000000',
  asset: 'lovelace',
  payTo: 'addr_test1qx2fxv2',
  maxTimeoutSeconds: 600,
  description: 'analyse',
};

function makeStubSigner(args: { addressValue?: string } = {}): {
  signer: CardanoSigner;
  signPayment: ReturnType<typeof vi.fn>;
} {
  const signPayment = vi.fn(
    async (_args: SignPaymentArgs): Promise<SignedPayment> => ({
      cborBase64: SIGNED_TX_CBOR_BASE64,
      nonce: NONCE,
      txHash: TX_HASH,
    })
  );
  const signer: CardanoSigner = {
    address: async () => args.addressValue ?? 'addr_test1qx2sender',
    signPayment,
  };
  return { signer, signPayment };
}

function makePaymentRequiredHeader(overrides?: Record<string, unknown>): string {
  const payload = {
    x402Version: 2,
    error: null,
    resource: {
      description: 'analyse',
      mimeType: 'application/json',
      url: '/api/analyze',
    },
    accepts: [
      {
        scheme: 'exact',
        network: STUB_ENDPOINT.network,
        amount: STUB_ENDPOINT.amount,
        payTo: STUB_ENDPOINT.payTo,
        maxTimeoutSeconds: STUB_ENDPOINT.maxTimeoutSeconds,
        asset: STUB_ENDPOINT.asset,
        extra: null,
      },
    ],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function makePaymentResponseHeader(): string {
  return Buffer.from(
    JSON.stringify({
      success: true,
      transaction: TX_HASH,
      network: STUB_ENDPOINT.network,
      extensions: { status: 'confirmed' },
    })
  ).toString('base64');
}

async function payThrough402WithResponseHeader(
  responseHeader: string
): Promise<{
  result: Awaited<ReturnType<typeof payAndFetch>>;
  signPayment: ReturnType<typeof vi.fn>;
}> {
  const { signer, signPayment } = makeStubSigner();
  const calls: RequestInit[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit = {}) => {
    calls.push(init);
    if (calls.length === 1) {
      return new Response(null, {
        status: 402,
        headers: { 'payment-required': makePaymentRequiredHeader() },
      });
    }
    return new Response(JSON.stringify({ result: 'ok' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-payment-response': responseHeader,
      },
    });
  });

  const result = await payAndFetch({
    baseUrl: 'https://api.example.com',
    endpoint: STUB_ENDPOINT,
    body: { foo: 'bar' },
    signer,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  return { result, signPayment };
}

describe('payAndFetch', () => {
  it('returns the response straight away when status is not 402', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await payAndFetch({
      baseUrl: 'https://api.example.com',
      endpoint: STUB_ENDPOINT,
      body: { foo: 'bar' },
      signer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe(200);
    expect(signPayment).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('completes the 402 -> sign -> retry cycle and surfaces the payment header', async () => {
    const { signer, signPayment } = makeStubSigner();
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit = {}) => {
      calls.push(init);
      if (calls.length === 1) {
        return new Response(null, {
          status: 402,
          headers: { 'payment-required': makePaymentRequiredHeader() },
        });
      }
      return new Response(JSON.stringify({ result: 'ok' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-payment-response': makePaymentResponseHeader(),
        },
      });
    });

    const result = await payAndFetch({
      baseUrl: 'https://api.example.com',
      endpoint: STUB_ENDPOINT,
      body: { foo: 'bar' },
      signer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signPayment).toHaveBeenCalledOnce();
    expect(signPayment).toHaveBeenCalledWith({
      payTo: STUB_ENDPOINT.payTo,
      amount: BigInt(STUB_ENDPOINT.amount),
      asset: STUB_ENDPOINT.asset,
      ttlSeconds: STUB_ENDPOINT.maxTimeoutSeconds,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ result: 'ok' });
    expect(result.payment).toEqual({
      transaction: TX_HASH,
      network: STUB_ENDPOINT.network,
      payer: undefined,
      status: 'confirmed',
    });

    // Retry request must carry exactly one canonical Payment-Signature
    // header. Audit M20 — duplicate headers caused spec-misreads downstream.
    const retryHeaders = (calls[1].headers ?? {}) as Record<string, string>;
    expect(retryHeaders['Payment-Signature']).toBeDefined();
    expect(retryHeaders['PAYMENT-SIGNATURE']).toBeUndefined();

    const decoded = JSON.parse(
      Buffer.from(retryHeaders['Payment-Signature'], 'base64').toString('utf-8')
    ) as Record<string, unknown>;
    expect(decoded.x402Version).toBe(2);
    const accepted = decoded.accepted as Record<string, unknown>;
    expect(accepted.amount).toBe(STUB_ENDPOINT.amount);
    expect(accepted.payTo).toBe(STUB_ENDPOINT.payTo);
    const payload = decoded.payload as Record<string, unknown>;
    expect(payload.nonce).toBe(NONCE);
    expect(payload.transaction).toBe(SIGNED_TX_CBOR_BASE64);
  });

  it('returns null payment for malformed X-Payment-Response header', async () => {
    const { result, signPayment } = await payThrough402WithResponseHeader('!!!not-base64!!!');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ result: 'ok' });
    expect(result.payment).toBeNull();
    expect(signPayment).toHaveBeenCalledOnce();
  });

  it('returns null payment for oversized X-Payment-Response header', async () => {
    const { result, signPayment } = await payThrough402WithResponseHeader(
      'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1)
    );

    expect(result.status).toBe(200);
    expect(result.payment).toBeNull();
    expect(signPayment).toHaveBeenCalledOnce();
  });

  it('returns null payment for schema-invalid X-Payment-Response header', async () => {
    const { result, signPayment } = await payThrough402WithResponseHeader(
      Buffer.from(JSON.stringify({ transaction: '', network: '' })).toString('base64')
    );

    expect(result.status).toBe(200);
    expect(result.payment).toBeNull();
    expect(signPayment).toHaveBeenCalledOnce();
  });

  it('refuses to pay when the 402 quotes a different payTo than the catalog', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 402,
        headers: {
          'payment-required': makePaymentRequiredHeader({
            accepts: [
              {
                scheme: 'exact',
                network: STUB_ENDPOINT.network,
                amount: STUB_ENDPOINT.amount,
                payTo: 'addr_test1q_ATTACKER',
                maxTimeoutSeconds: 600,
                asset: 'lovelace',
                extra: null,
              },
            ],
          }),
        },
      })
    );

    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint: STUB_ENDPOINT,
        body: { foo: 'bar' },
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Cardano402ValidationError);
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('refuses malformed Payment-Required headers before signing', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 402,
        headers: { 'payment-required': '!!!not-base64!!!' },
      })
    );

    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint: STUB_ENDPOINT,
        body: { foo: 'bar' },
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Cardano402ValidationError);
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('refuses oversized Payment-Required headers before signing', async () => {
    const { signer, signPayment } = makeStubSigner();
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 402,
        headers: { 'payment-required': 'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1) },
      })
    );

    await expect(
      payAndFetch({
        baseUrl: 'https://api.example.com',
        endpoint: STUB_ENDPOINT,
        body: { foo: 'bar' },
        signer,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Cardano402ValidationError);
    expect(signPayment).not.toHaveBeenCalled();
  });

  it('appends query parameters to the URL', async () => {
    const { signer } = makeStubSigner();
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.example.com/api/analyze?ref=cli');
      return new Response('hi', { status: 200 });
    });
    await payAndFetch({
      baseUrl: 'https://api.example.com',
      endpoint: { ...STUB_ENDPOINT, method: 'GET' },
      query: { ref: 'cli' },
      signer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
