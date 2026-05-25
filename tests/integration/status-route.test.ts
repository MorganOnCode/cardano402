import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';

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

// Mock @blockfrost/blockfrost-js to prevent real API calls.
// The status route accesses blockfrostClient.getTransaction() via the chain provider.
// We need to mock the BlockfrostClient's getTransaction at the source level.
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

// Mock settlePayment to avoid import issues in settle route
vi.mock('../../src/settle/settle-payment.js', () => ({
  settlePayment: vi.fn().mockResolvedValue({ success: true }),
  computeDedupKey: vi.fn(),
  pollConfirmation: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_TX_HASH = 'abc123def456789012345678901234567890123456789012345678901234abcd';

function createTestStatusRequest(overrides?: Record<string, unknown>) {
  return {
    transaction: VALID_TX_HASH,
    paymentRequirements: {
      scheme: 'exact',
      network: 'cardano:preview',
      asset: 'lovelace',
      amount: '2000000',
      payTo:
        'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
      maxTimeoutSeconds: 300,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /status Route', () => {
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
    mockGetTransaction.mockReset();
  });

  // ---- Confirmed transaction ----

  it('should return confirmed status when transaction exists on-chain', async () => {
    mockGetTransaction.mockResolvedValueOnce({
      hash: VALID_TX_HASH,
      block: 'block123',
      block_height: 100,
      block_time: 1700000000,
      slot: 12345,
      index: 0,
      fees: '170000',
      valid_contract: true,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: createTestStatusRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('confirmed');
    expect(body.transaction).toBe(VALID_TX_HASH);
  });

  // ---- Pending transaction ----

  it('should return pending status when transaction is not yet confirmed', async () => {
    mockGetTransaction.mockResolvedValueOnce(null);

    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: createTestStatusRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('pending');
    expect(body.transaction).toBe(VALID_TX_HASH);
  });

  // ---- Invalid request bodies ----

  it('should return not_found for invalid tx hash format (too short)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: createTestStatusRequest({ transaction: 'tooshort' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('not_found');
    expect(body.transaction).toBe('');
  });

  it('should return not_found for empty body', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('not_found');
    expect(body.transaction).toBe('');
  });

  it('should return not_found for missing paymentRequirements', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: { transaction: VALID_TX_HASH },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('not_found');
    expect(body.transaction).toBe('');
  });

  // ---- Unexpected errors ----

  it('should return HTTP 500 when getTransaction throws unexpectedly', async () => {
    mockGetTransaction.mockRejectedValueOnce(new Error('Network error'));

    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: createTestStatusRequest(),
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Internal Server Error');
    // Should NOT leak internal error details
    expect(body.message).not.toContain('Network error');
  });

  // ---- Route existence ----

  it('should respond to POST /status (not 404)', async () => {
    mockGetTransaction.mockResolvedValueOnce(null);

    const response = await server.inject({
      method: 'POST',
      url: '/status',
      headers: { 'content-type': 'application/json' },
      payload: createTestStatusRequest(),
    });

    expect(response.statusCode).not.toBe(404);
  });
});
