import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';
import { SupportedResponseSchema } from '../../src/sdk/types.js';

// Mock Lucid Evolution packages to prevent native module loading (libsodium)
const mockWalletAddress = vi
  .fn()
  .mockReturnValue(
    'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp'
  );

vi.mock('@lucid-evolution/lucid', () => ({
  Lucid: vi.fn().mockResolvedValue({
    selectWallet: { fromSeed: vi.fn(), fromPrivateKey: vi.fn() },
    wallet: () => ({ address: mockWalletAddress }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /supported Route', () => {
  let server: FastifyInstance;

  const testConfig: Config = {
    server: { host: '0.0.0.0', port: 0 },
    logging: { level: 'error', pretty: false },
    rateLimit: { global: 100, windowMs: 60000, sensitive: 20 },
    metrics: {},
    env: 'test',
    storage: {
      backend: 'fs',
      fs: { dataDir: './data/files' },
      ipfs: { apiUrl: 'http://localhost:5001' },
    },
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
  };

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: testConfig });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  // ---- Happy path ----

  it('should return HTTP 200 for GET /supported', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    expect(response.statusCode).toBe(200);
  });

  it('should return kinds array with correct payment kind', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    const body = JSON.parse(response.body);
    expect(body.kinds).toHaveLength(1);
    expect(body.kinds[0]).toEqual({
      x402Version: 2,
      scheme: 'exact',
      network: 'cardano:preview',
    });
  });

  it('should return empty extensions array', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    const body = JSON.parse(response.body);
    expect(body.extensions).toEqual([]);
  });

  it('should return signers with configured network key and wallet address', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    const body = JSON.parse(response.body);
    expect(body.signers).toHaveProperty('cardano:*');
    expect(body.signers['cardano:*']).toEqual([
      'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
    ]);
  });

  // ---- Content type ----

  it('should return application/json content type', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    expect(response.headers['content-type']).toContain('application/json');
  });

  // ---- Error handling ----

  it('should return 500 when getAddress() throws', async () => {
    mockWalletAddress.mockImplementationOnce(() => {
      throw new Error('Wallet not initialized');
    });

    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Internal Server Error');
  });

  // ---- Schema validation ----

  it('should return a response that validates against SupportedResponseSchema', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/supported',
    });

    const body = JSON.parse(response.body);
    const parsed = SupportedResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });
});
