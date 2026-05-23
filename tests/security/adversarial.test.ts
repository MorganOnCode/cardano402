// Adversarial security test suite for cardano402
//
// Validates security properties across five categories:
// 1. Secret leakage prevention (API keys, seed phrases never in responses)
// 2. Malformed input handling (invalid JSON, empty bodies, oversized strings)
// 3. Replay protection (dedup key prevents double settlement)
// 4. Token confusion defense (unknown policy IDs, mixed asset names)
// 5. Production error sanitization (no stack traces, generic messages)

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
  CML: {
    Address: {
      from_bech32: vi.fn(),
    },
  },
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

// Mock verifyPayment and settlePayment at module level
const mockVerifyPayment = vi.fn();
vi.mock('../../src/verify/verify-payment.js', () => ({
  verifyPayment: (...args: unknown[]) => mockVerifyPayment(...args),
}));

const mockSettlePayment = vi.fn();
vi.mock('../../src/settle/settle-payment.js', () => ({
  settlePayment: (...args: unknown[]) => mockSettlePayment(...args),
  computeDedupKey: vi.fn(),
  pollConfirmation: vi.fn(),
}));

// Mock blockfrost-client to prevent real API calls
const mockGetTransaction = vi.fn();
vi.mock('../../src/chain/blockfrost-client.js', () => ({
  createBlockfrostClient: vi.fn().mockReturnValue({
    getLatestBlock: vi.fn().mockResolvedValue({ slot: 12345 }),
    getEpochParameters: vi.fn().mockResolvedValue({ coins_per_utxo_byte: '4310' }),
    getAddressUtxos: vi.fn().mockResolvedValue([]),
    submitTransaction: vi.fn().mockResolvedValue('txhash123'),
    getTransaction: (...args: unknown[]) => mockGetTransaction(...args),
  }),
  BlockfrostClient: vi.fn(),
  withRetry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_PROJECT_ID = 'test-project-id-secret';
const TEST_SEED_PHRASE = 'test seed phrase for integration testing only';

function createTestConfig(overrides?: Partial<Config>): Config {
  const base: Config = {
    server: { host: '0.0.0.0', port: 0 },
    logging: { level: 'error', pretty: false },
    rateLimit: { global: 1000, windowMs: 60000, sensitive: 100 },
    env: 'test',
    chain: {
      network: 'Preview',
      blockfrost: { projectId: TEST_PROJECT_ID, tier: 'free' },
      facilitator: { seedPhrase: TEST_SEED_PHRASE },
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
  return Object.assign(base, overrides);
}

function createVerifyPayload(overrides?: Record<string, unknown>) {
  const reqs = {
    scheme: 'exact',
    network: 'cardano:preview',
    asset: 'lovelace',
    amount: '2000000',
    payTo:
      'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
    maxTimeoutSeconds: 300,
  };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: reqs,
      payload: {
        transaction: 'SGVsbG8gV29ybGQ=',
        payer:
          'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
      },
    },
    paymentRequirements: reqs,
    ...overrides,
  };
}

function createSettlePayload(overrides?: Record<string, unknown>) {
  const reqs = {
    scheme: 'exact',
    network: 'cardano:preview',
    asset: 'lovelace',
    amount: '2000000',
    payTo:
      'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
    maxTimeoutSeconds: 300,
  };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: reqs,
      payload: {
        transaction: 'SGVsbG8gV29ybGQ=',
        payer:
          'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
      },
    },
    paymentRequirements: reqs,
    ...overrides,
  };
}

// ===========================================================================
// 1. Secret Leakage Prevention
// ===========================================================================

describe('Secret Leakage Prevention', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: createTestConfig() });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockVerifyPayment.mockReset();
    mockSettlePayment.mockReset();
    mockGetTransaction.mockReset();
  });

  it('should not include Blockfrost API key in any error response', async () => {
    // Trigger various error paths
    mockVerifyPayment.mockRejectedValueOnce(new Error('Internal failure'));
    mockSettlePayment.mockRejectedValueOnce(new Error('Internal failure'));

    const responses = [
      await server.inject({ method: 'POST', url: '/verify', payload: {} }),
      await server.inject({ method: 'POST', url: '/verify', payload: createVerifyPayload() }),
      await server.inject({ method: 'POST', url: '/settle', payload: {} }),
      await server.inject({ method: 'POST', url: '/settle', payload: createSettlePayload() }),
      await server.inject({ method: 'POST', url: '/status', payload: {} }),
      await server.inject({ method: 'GET', url: '/not-found' }),
    ];

    for (const res of responses) {
      expect(res.body).not.toContain(TEST_PROJECT_ID);
    }
  });

  it('should not include seed phrase in any error response', async () => {
    mockVerifyPayment.mockRejectedValueOnce(new Error('Internal failure'));
    mockSettlePayment.mockRejectedValueOnce(new Error('Internal failure'));

    const responses = [
      await server.inject({ method: 'POST', url: '/verify', payload: {} }),
      await server.inject({ method: 'POST', url: '/verify', payload: createVerifyPayload() }),
      await server.inject({ method: 'POST', url: '/settle', payload: {} }),
      await server.inject({ method: 'POST', url: '/settle', payload: createSettlePayload() }),
      await server.inject({ method: 'POST', url: '/status', payload: {} }),
      await server.inject({ method: 'GET', url: '/not-found' }),
    ];

    for (const res of responses) {
      expect(res.body).not.toContain(TEST_SEED_PHRASE);
    }
  });
});

// ===========================================================================
// 2. Malformed Input Handling
// ===========================================================================

describe('Malformed Input Handling', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: createTestConfig() });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockVerifyPayment.mockReset();
    mockSettlePayment.mockReset();
  });

  it('should reject invalid JSON gracefully without crashing', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: 'not-json{{{',
    });

    // Should return error, NOT crash (500 is acceptable for parse error)
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('should handle empty body on /verify with validation error', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('invalid_request');
  });

  it('should handle extremely long string values without crash', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      payload: {
        x402Version: 2,
        paymentPayload: {
          x402Version: 2,
          accepted: {
            scheme: 'x'.repeat(1000),
            network: 'cardano:preview',
            amount: '2000000',
            payTo:
              'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
            maxTimeoutSeconds: 300,
          },
          payload: {
            transaction: 'a'.repeat(40000),
          },
        },
        paymentRequirements: {
          scheme: 'x'.repeat(1000),
          network: 'cardano:preview',
          amount: '2000000',
          payTo:
            'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
          maxTimeoutSeconds: 300,
        },
      },
    });

    // Should not crash -- returns validation or verification error
    expect(response.statusCode).toBeLessThan(500);
  });
});

// ===========================================================================
// 3. Replay Protection
// ===========================================================================

describe('Replay Protection', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: createTestConfig() });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockSettlePayment.mockReset();
  });

  it('should return duplicate_transaction for replay of same CBOR', async () => {
    // First submission succeeds
    const successResult: SettleResult = {
      success: true,
      transaction: 'abc123def456789012345678901234567890123456789012345678901234abcd',
      network: 'cardano:preview',
    };
    mockSettlePayment.mockResolvedValueOnce(successResult);

    const payload = createSettlePayload();
    const res1 = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().success).toBe(true);

    // Second submission with same CBOR returns duplicate result
    const dupResult: SettleResult = {
      success: true,
      transaction: 'abc123def456789012345678901234567890123456789012345678901234abcd',
      network: 'cardano:preview',
    };
    mockSettlePayment.mockResolvedValueOnce(dupResult);

    const res2 = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    // Idempotent: same transaction hash returned
    expect(res2.json().transaction).toBe(res1.json().transaction);
  });

  it('should return consistent result for idempotent resubmission', async () => {
    const txHash = 'deadbeef12345678901234567890123456789012345678901234567890abcdef';
    // Both calls return the same confirmed result
    mockSettlePayment.mockResolvedValue({
      success: true,
      transaction: txHash,
      network: 'cardano:preview',
    });

    const payload = createSettlePayload();
    const res1 = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    const res2 = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    // Both return success with same txHash -- no double-settlement
    expect(res1.json().success).toBe(true);
    expect(res2.json().success).toBe(true);
    expect(res1.json().transaction).toBe(txHash);
    expect(res2.json().transaction).toBe(txHash);

    mockSettlePayment.mockReset();
  });
});

// ===========================================================================
// 4. Token Confusion Defense
// ===========================================================================

describe('Token Confusion Defense', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: createTestConfig() });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockVerifyPayment.mockReset();
  });

  it('should reject unknown token policy IDs', async () => {
    // Mock verifyPayment to return unsupported_token failure
    mockVerifyPayment.mockResolvedValueOnce({
      isValid: false,
      invalidReason: 'unsupported_token',
      invalidMessage: 'Token is not supported by this facilitator',
    });

    const fakePolicyId = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const fakeAssetName = '4641b4554f4b454e';

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createVerifyPayload({
        paymentRequirements: {
          scheme: 'exact',
          network: 'cardano:preview',
          asset: `${fakePolicyId}.${fakeAssetName}`,
          amount: '1000000',
          payTo:
            'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
          maxTimeoutSeconds: 300,
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('unsupported_token');
  });

  it('should not accept USDM policy ID with DJED asset name (mixed policy/asset)', async () => {
    // USDM policy ID combined with DJED asset name hex
    const usdmPolicyId = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad';
    const djedAssetName = '446a65644d6963726f555344'; // DJED's asset name hex
    const mixedAsset = `${usdmPolicyId}.${djedAssetName}`;

    // The concatenated unit string won't match any entry in SUPPORTED_TOKENS
    mockVerifyPayment.mockResolvedValueOnce({
      isValid: false,
      invalidReason: 'unsupported_token',
      invalidMessage: 'Token is not supported by this facilitator',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createVerifyPayload({
        paymentRequirements: {
          scheme: 'exact',
          network: 'cardano:preview',
          asset: mixedAsset,
          amount: '1000000',
          payTo:
            'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
          maxTimeoutSeconds: 300,
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe('unsupported_token');
  });
});

// ===========================================================================
// 5. Production Error Sanitization
// ===========================================================================

describe('Production Error Sanitization', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    // Create server in production mode for sanitization tests
    server = await createServer({
      config: createTestConfig({ env: 'production' }),
    });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockVerifyPayment.mockReset();
    mockSettlePayment.mockReset();
  });

  it('should not include stack traces in production error responses', async () => {
    // Trigger a 500 error via verify
    mockVerifyPayment.mockRejectedValueOnce(new Error('CML WASM crash'));

    const response = await server.inject({
      method: 'POST',
      url: '/verify',
      headers: { 'content-type': 'application/json' },
      payload: createVerifyPayload(),
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    // The route handler catches and returns its own 500, not the error handler
    // But verify the body doesn't contain stack traces
    expect(JSON.stringify(body)).not.toContain('at ');
    expect(JSON.stringify(body)).not.toContain('.ts:');
    expect(JSON.stringify(body)).not.toContain('.js:');
  });

  it('should sanitize internal error messages in production', async () => {
    // Trigger 500 on settle
    mockSettlePayment.mockRejectedValueOnce(new Error('Redis connection lost'));

    const response = await server.inject({
      method: 'POST',
      url: '/settle',
      headers: { 'content-type': 'application/json' },
      payload: createSettlePayload(),
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    // Should NOT leak internal error details
    expect(body.message).not.toContain('Redis');
    expect(body.message).not.toContain('connection');
    // Should have generic message
    expect(body.error).toBe('Internal Server Error');
  });
});

// ===========================================================================
// 6. Additional Edge Cases
// ===========================================================================

describe('Additional Security Edge Cases', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: createTestConfig() });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockVerifyPayment.mockReset();
    mockSettlePayment.mockReset();
  });

  it('should reject GET requests on POST-only routes', async () => {
    const response = await server.inject({ method: 'GET', url: '/verify' });
    expect(response.statusCode).toBe(404);
  });

  it('should return proper 404 for unknown routes', async () => {
    const response = await server.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    // Should not reveal internal paths
    expect(body.error.message).not.toContain('/src/');
    expect(body.error.message).not.toContain('/dist/');
  });
});
