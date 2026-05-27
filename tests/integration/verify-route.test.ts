import { MAX_PAYMENT_HEADER_LENGTH } from '@cardano402/core';
import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';
import type { VerifyResponse } from '../../src/verify/types.js';

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

// Mock verifyPayment to avoid needing real CML/Blockfrost
// Route-level integration tests focus on HTTP handling, not CBOR verification
//
// Mock using the relative-from-source path that matches how the route imports it.
// vi.mock resolves relative to the test file, so we compute the correct path.
const mockVerifyPayment = vi.fn();
vi.mock('../../src/verify/verify-payment.js', () => ({
  verifyPayment: (...args: unknown[]) => mockVerifyPayment(...args),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestVerifyRequest(
  paymentRequirementsOverrides?: Record<string, unknown>,
  topLevelOverrides?: Record<string, unknown>
) {
  const reqs = {
    scheme: 'exact',
    network: 'cardano:preview',
    asset: 'lovelace',
    amount: '2000000',
    payTo:
      'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
    maxTimeoutSeconds: 300,
    ...paymentRequirementsOverrides,
  };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: reqs,
      payload: {
        transaction: 'SGVsbG8gV29ybGQ=', // valid base64
        payer:
          'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
      },
    },
    paymentRequirements: reqs,
    ...topLevelOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /verify Route', () => {
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
    mockVerifyPayment.mockReset();
  });

  // ---- Valid requests ----

  it('should return HTTP 200 with isValid: true when verification passes', async () => {
    const successResponse: VerifyResponse = {
      isValid: true,
      payer: 'addr_test1qz...',
      extensions: { scheme: 'exact', amount: '2000000', payTo: 'addr_test1qx...' },
    };
    mockVerifyPayment.mockResolvedValueOnce(successResponse);

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(true);
    expect(body.payer).toBe('addr_test1qz...');
  });

  it('should pass VerifyContext to verifyPayment with correct fields', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ isValid: true });

    await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(),
    });

    expect(mockVerifyPayment).toHaveBeenCalledOnce();
    const ctx = mockVerifyPayment.mock.calls[0][0];
    expect(ctx.scheme).toBe('exact');
    expect(ctx.network).toBe('cardano:preview');
    expect(ctx.payTo).toBe(
      'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7'
    );
    expect(ctx.requiredAmount).toBe(BigInt('2000000'));
    expect(ctx.maxTimeoutSeconds).toBe(300);
    expect(ctx.transactionCbor).toBe('SGVsbG8gV29ybGQ=');
    expect(ctx.configuredNetwork).toBe('cardano:preview');
    expect(ctx.feeMin).toBe(BigInt(150000));
    expect(ctx.feeMax).toBe(BigInt(5000000));
    expect(typeof ctx.getCurrentSlot).toBe('function');
    expect(typeof ctx.requestedAt).toBe('number');
  });

  // ---- Verification failures (valid request, verification rejects) ----

  it('should return HTTP 200 with isValid: false when verification fails', async () => {
    const failResponse: VerifyResponse = {
      isValid: false,
      invalidReason: 'recipient_mismatch',
      invalidMessage: 'No output pays to the required recipient',
    };
    mockVerifyPayment.mockResolvedValueOnce(failResponse);

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('recipient_mismatch');
  });

  // ---- Invalid request bodies ----

  it('should return isValid: false with invalid_request for empty body', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
    expect(body.invalidMessage).toBe('Request body does not match expected format');
    expect(body.extensions.errors).toBeDefined();
    expect(Array.isArray(body.extensions.errors)).toBe(true);
  });

  it('should return invalid_request for wrong x402Version', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(undefined, {
        paymentPayload: {
          x402Version: 1,
          scheme: 'exact',
          network: 'cardano:preview',
          payload: { transaction: 'SGVsbG8=', payer: 'addr_test1qz...' },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
  });

  it('should return invalid_request for missing paymentRequirements', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: {
        paymentPayload: {
          x402Version: 2,
          scheme: 'exact',
          network: 'cardano:preview',
          payload: { transaction: 'SGVsbG8=', payer: 'addr_test1qz...' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
  });

  it('should return invalid_request for missing transaction in payload', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(undefined, {
        paymentPayload: {
          x402Version: 2,
          scheme: 'exact',
          network: 'cardano:preview',
          payload: {},
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
  });

  it('should return invalid_request for over-uint64 payment amounts before verification', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest({ amount: '18446744073709551616' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for payment timeouts above configured maximum before verification', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest({ maxTimeoutSeconds: 301 }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
    expect(body.invalidMessage).toContain('maxTimeoutSeconds');
    expect(body.extensions.configuredMaxTimeoutSeconds).toBe(300);
    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for malformed paymentHeader before verification', async () => {
    const base = createTestVerifyRequest();
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: {
        x402Version: 2,
        paymentHeader: '!!!not-base64!!!',
        paymentRequirements: base.paymentRequirements,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
    expect(body.extensions.errorKind).toBe('invalid_base64');
    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  it('should return invalid_request for oversized paymentHeader before verification', async () => {
    const base = createTestVerifyRequest();
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: {
        x402Version: 2,
        paymentHeader: 'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1),
        paymentRequirements: base.paymentRequirements,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  // ---- Unexpected errors ----

  it('should return HTTP 500 when verifyPayment throws unexpectedly', async () => {
    mockVerifyPayment.mockRejectedValueOnce(new Error('CML WASM crash'));

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(),
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Internal Server Error');
    // Should NOT leak internal error details
    expect(body.message).not.toContain('CML');
    expect(body.message).not.toContain('WASM');
  });

  // ---- Route existence ----

  it('should respond to POST /verify (not 404)', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ isValid: true });

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(),
    });

    expect(response.statusCode).not.toBe(404);
  });

  it('should return 404 for GET /verify (only POST is registered)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/verify',
    });

    expect(response.statusCode).toBe(404);
  });

  // ---- Token payment tests (Phase 5) ----

  it('should thread token asset into verifyPayment context', async () => {
    const usdmAsset = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d';
    mockVerifyPayment.mockResolvedValueOnce({ isValid: true });

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest({ asset: usdmAsset }),
    });

    expect(response.statusCode).toBe(200);
    const ctx = mockVerifyPayment.mock.calls[0][0];
    expect(ctx.asset).toBe(usdmAsset);
  });

  it('should default asset to lovelace when omitted from paymentRequirements', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ isValid: true });

    // Omit asset field entirely -- Zod schema default should fill in 'lovelace'
    const payload = createTestVerifyRequest();
    delete (payload.paymentRequirements as Record<string, unknown>).asset;

    await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(mockVerifyPayment).toHaveBeenCalledOnce();
    const ctx = mockVerifyPayment.mock.calls[0][0];
    expect(ctx.asset).toBe('lovelace');
  });

  it('should provide getMinUtxoLovelace callback in verifyPayment context', async () => {
    mockVerifyPayment.mockResolvedValueOnce({ isValid: true });

    await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest(),
    });

    expect(mockVerifyPayment).toHaveBeenCalledOnce();
    const ctx = mockVerifyPayment.mock.calls[0][0];
    expect(typeof ctx.getMinUtxoLovelace).toBe('function');
  });

  it('should surface token verification failure from verifyPayment', async () => {
    mockVerifyPayment.mockResolvedValueOnce({
      isValid: false,
      invalidReason: 'unsupported_token',
      invalidMessage: 'Token is not supported by this facilitator',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createTestVerifyRequest({
        asset: `${'d'.repeat(56)}.cafe`,
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('unsupported_token');
    expect(body.invalidMessage).toBe('Token is not supported by this facilitator');
  });
});
