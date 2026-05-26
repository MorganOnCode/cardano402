import { MAX_PAYMENT_HEADER_LENGTH } from '@cardano402/core';
import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';
import type { SettleResult } from '../../src/settle/types.js';

// Mock Lucid Evolution packages to prevent native module loading (libsodium)
vi.mock('@lucid-evolution/lucid', () => ({
  Lucid: vi.fn().mockResolvedValue({
    selectWallet: { fromSeed: vi.fn(), fromPrivateKey: vi.fn() },
    newTx: vi.fn(),
    config: vi.fn(),
  }),
}));
vi.mock('@lucid-evolution/provider', () => ({
  Blockfrost: vi.fn(),
}));

// Mock ioredis to prevent real Redis connections
vi.mock('ioredis', () => {
  class RedisMock {
    connect = vi.fn().mockResolvedValue(undefined);
    quit = vi.fn().mockResolvedValue(undefined);
    ping = vi.fn().mockResolvedValue('PONG');
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    del = vi.fn().mockResolvedValue(1);
    keys = vi.fn().mockResolvedValue([]);
    mget = vi.fn().mockResolvedValue([]);
    on = vi.fn().mockReturnThis();
    status = 'ready';
  }
  return { default: RedisMock };
});

// Mock settlePayment to avoid needing real CML/Blockfrost
const mockSettlePayment = vi.fn();
vi.mock('../../src/settle/settle-payment.js', () => ({
  settlePayment: (...args: unknown[]) => mockSettlePayment(...args),
  computeDedupKey: vi.fn(),
  pollConfirmation: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** V2-aligned payment requirements */
const basePaymentRequirements = {
  scheme: 'exact',
  network: 'cardano:preview',
  asset: 'lovelace',
  amount: '2000000',
  payTo:
    'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
  maxTimeoutSeconds: 300,
};

function createTestSettleRequest(
  paymentRequirementsOverrides?: Record<string, unknown>,
  topLevelOverrides?: Record<string, unknown>
) {
  const reqs = { ...basePaymentRequirements, ...paymentRequirementsOverrides };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: reqs,
      payload: {
        transaction: 'SGVsbG8gV29ybGQ=', // valid base64
        payer: 'addr_test1qz...',
      },
    },
    paymentRequirements: reqs,
    ...topLevelOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /settle Route', () => {
  let server: FastifyInstance;

  const testConfig: Config = {
    server: { host: '0.0.0.0', port: 0 },
    logging: { level: 'error', pretty: false },
    rateLimit: { global: 100, windowMs: 60000, sensitive: 20 },
    metrics: {},
    env: 'test',
    chain: {
      network: 'Preview',
      blockfrost: { projectId: 'test-project-id', tier: 'free' },
      facilitator: { seedPhrase: 'test seed phrase for integration testing only' },
      cache: { utxoTtlSeconds: 60 },
      redis: { host: '127.0.0.1', port: 6379, db: 0 },
      verification: {
        graceBufferSeconds: 30,
        maxTimeoutSeconds: 300,
        feeMinLovelace: 150000,
        feeMaxLovelace: 5000000,
        requireNonce: false,
        confirmationMode: 'confirmed_only' as const,
        minConfirmations: 1,
      },
    },
    storage: {
      backend: 'fs' as const,
      fs: { dataDir: './data/files' },
      ipfs: { apiUrl: 'http://localhost:5001' },
    },
  };

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: testConfig });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockSettlePayment.mockReset();
  });

  // ---- Valid requests: success ----

  it('should return HTTP 200 with success: true when settlement succeeds', async () => {
    const successResult: SettleResult = {
      success: true,
      transaction: 'abc123def456789012345678901234567890123456789012345678901234abcd',
      network: 'cardano:preview',
    };
    mockSettlePayment.mockResolvedValueOnce(successResult);

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.transaction).toBe(
      'abc123def456789012345678901234567890123456789012345678901234abcd'
    );
    expect(body.network).toBe('cardano:preview');
  });

  // ---- Valid requests: verification failure ----

  it('should return HTTP 200 with success: false when verification fails', async () => {
    const failResult: SettleResult = {
      success: false,
      transaction: '',
      network: 'cardano:preview',
      errorReason: 'verification_failed',
      errorMessage: 'Payment verification failed',
    };
    mockSettlePayment.mockResolvedValueOnce(failResult);

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe('verification_failed');
  });

  // ---- Valid requests: confirmation timeout ----

  it('should return HTTP 200 with timeout reason when confirmation times out', async () => {
    const timeoutResult: SettleResult = {
      success: false,
      transaction: 'abc123def456789012345678901234567890123456789012345678901234abcd',
      network: 'cardano:preview',
      errorReason: 'confirmation_timeout',
      errorMessage: 'Transaction submitted but confirmation timed out',
    };
    mockSettlePayment.mockResolvedValueOnce(timeoutResult);

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe('confirmation_timeout');
    expect(body.transaction).toBe(
      'abc123def456789012345678901234567890123456789012345678901234abcd'
    );
  });

  // ---- Invalid request bodies ----

  it('should return invalid_request for missing x402Version', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: {
        paymentPayload: {
          x402Version: 2,
          accepted: basePaymentRequirements,
          payload: { transaction: 'SGVsbG8gV29ybGQ=' },
        },
        paymentRequirements: basePaymentRequirements,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
  });

  it('should return invalid_request for missing paymentRequirements', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: {
        x402Version: 2,
        paymentPayload: {
          x402Version: 2,
          accepted: basePaymentRequirements,
          payload: { transaction: 'SGVsbG8gV29ybGQ=' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
  });

  it('should return invalid_request for empty body', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
  });

  it('should return invalid_request for over-uint64 payment amounts before settlement', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest({ amount: '18446744073709551616' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
    expect(mockSettlePayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for payment timeouts above configured maximum before settlement', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest({ maxTimeoutSeconds: 301 }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
    expect(body.errorMessage).toContain('maxTimeoutSeconds');
    expect(mockSettlePayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for malformed paymentHeader before settlement', async () => {
    const base = createTestSettleRequest();
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: {
        x402Version: 2,
        paymentHeader: '!!!not-base64!!!',
        paymentRequirements: base.paymentRequirements,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
    expect(mockSettlePayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for oversized paymentHeader before settlement', async () => {
    const base = createTestSettleRequest();
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: {
        x402Version: 2,
        paymentHeader: 'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1),
        paymentRequirements: base.paymentRequirements,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
    expect(mockSettlePayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for malformed transaction base64 before settlement', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(undefined, {
        paymentPayload: {
          ...createTestSettleRequest().paymentPayload,
          payload: {
            ...createTestSettleRequest().paymentPayload.payload,
            transaction: '!!!not-base64!!!',
          },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.network).toBe('cardano:preview');
    expect(body.errorReason).toBe('invalid_request');
    expect(mockSettlePayment).not.toHaveBeenCalled();
  });

  // ---- VerifyContext assembly ----

  it('should pass VerifyContext and cborBytes to settlePayment with correct fields', async () => {
    mockSettlePayment.mockResolvedValueOnce({
      success: true,
      transaction: 'abc',
      network: 'cardano:preview',
    });

    await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(mockSettlePayment).toHaveBeenCalledOnce();
    const [ctx, cborBytes, , , network] = mockSettlePayment.mock.calls[0];
    expect(ctx.scheme).toBe('exact');
    expect(ctx.network).toBe('cardano:preview');
    expect(ctx.payTo).toBe(
      'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7'
    );
    expect(ctx.requiredAmount).toBe(BigInt('2000000'));
    expect(ctx.maxTimeoutSeconds).toBe(300);
    expect(ctx.transactionCbor).toBe('SGVsbG8gV29ybGQ=');
    expect(ctx.payerAddress).toBe('addr_test1qz...');
    expect(ctx.configuredNetwork).toBe('cardano:preview');
    expect(ctx.feeMin).toBe(BigInt(150000));
    expect(ctx.feeMax).toBe(BigInt(5000000));
    expect(typeof ctx.getCurrentSlot).toBe('function');
    expect(typeof ctx.requestedAt).toBe('number');

    // cborBytes should be a Uint8Array decoded from base64
    expect(cborBytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(cborBytes).toString('base64')).toBe('SGVsbG8gV29ybGQ=');

    // network should be CAIP-2 string
    expect(network).toBe('cardano:preview');
  });

  // ---- Unexpected errors ----

  it('should return HTTP 500 when settlePayment throws unexpectedly', async () => {
    mockSettlePayment.mockRejectedValueOnce(new Error('Unexpected WASM crash'));

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).not.toContain('WASM');
  });

  // ---- Route existence ----

  it('should respond to POST /settle (not 404)', async () => {
    mockSettlePayment.mockResolvedValueOnce({
      success: true,
      transaction: 'abc',
      network: 'cardano:preview',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(response.statusCode).not.toBe(404);
  });

  // ---- Token payment tests (Phase 5) ----

  it('should thread token asset into settlePayment context', async () => {
    const usdmAsset = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d';
    mockSettlePayment.mockResolvedValueOnce({
      success: true,
      transaction: 'abc123def456789012345678901234567890123456789012345678901234abcd',
      network: 'cardano:preview',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest({ asset: usdmAsset }),
    });

    expect(response.statusCode).toBe(200);
    const ctx = mockSettlePayment.mock.calls[0][0];
    expect(ctx.asset).toBe(usdmAsset);
  });

  it('should default asset to lovelace when omitted from settle request', async () => {
    mockSettlePayment.mockResolvedValueOnce({
      success: true,
      transaction: 'abc',
      network: 'cardano:preview',
    });

    // Omit asset field entirely -- Zod schema default should fill in 'lovelace'
    const payload = createTestSettleRequest();
    delete (payload.paymentRequirements as Record<string, unknown>).asset;

    await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(mockSettlePayment).toHaveBeenCalledOnce();
    const ctx = mockSettlePayment.mock.calls[0][0];
    expect(ctx.asset).toBe('lovelace');
  });

  it('should provide getMinUtxoLovelace callback in settlePayment context', async () => {
    mockSettlePayment.mockResolvedValueOnce({
      success: true,
      transaction: 'abc',
      network: 'cardano:preview',
    });

    await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createTestSettleRequest(),
    });

    expect(mockSettlePayment).toHaveBeenCalledOnce();
    const ctx = mockSettlePayment.mock.calls[0][0];
    expect(typeof ctx.getMinUtxoLovelace).toBe('function');
  });
});
