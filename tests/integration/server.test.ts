import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';
import { createServer } from '../../src/server.js';

// Mock Lucid Evolution packages to prevent native module loading (libsodium)
// The Lucid() function must return a proper mock object with selectWallet
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

describe('Server Integration', () => {
  let server: FastifyInstance;

  const testConfig: Config = {
    server: { host: '0.0.0.0', port: 0 }, // Port 0 = random available port
    logging: { level: 'error', pretty: false }, // Quiet logs in tests
    rateLimit: { global: 100, windowMs: 60000, sensitive: 20 },
    env: 'test',
    chain: {
      network: 'Preview',
      blockfrost: { projectId: 'test-project-id', tier: 'free' },
      facilitator: { seedPhrase: 'test seed phrase for integration testing only' },
      cache: { utxoTtlSeconds: 60 },
      reservation: { ttlSeconds: 120, maxConcurrent: 20 },
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
    server = await createServer({ config: testConfig });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('should have security headers from helmet', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/nonexistent',
    });

    // Helmet sets these headers
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should return request ID in error responses', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/nonexistent',
      headers: {
        'x-request-id': 'test-request-123',
      },
    });

    const body = JSON.parse(response.body);
    expect(body.requestId).toBe('test-request-123');
  });

  it('should generate request ID if not provided', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/nonexistent',
    });

    const body = JSON.parse(response.body);
    expect(body.requestId).toBeDefined();
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  });

  it('should return 404 for unknown routes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/unknown-route',
    });

    expect(response.statusCode).toBe(404);
  });

  it('should include timestamp in error responses', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/nonexistent',
    });

    const body = JSON.parse(response.body);
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });
});
