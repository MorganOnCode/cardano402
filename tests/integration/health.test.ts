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

describe('Health Endpoint', () => {
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
    server = await createServer({ config: testConfig });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('should return 200 with health status', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.status).toBe('healthy');
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.dependencies).toBeDefined();
  });

  it('should include dependency status', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    expect(body.dependencies.redis).toBeDefined();
    expect(body.dependencies.storage).toBeDefined();
    expect(body.dependencies.redis.status).toBe('up');
  });

  it('should return ISO timestamp', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    const timestamp = new Date(body.timestamp);
    expect(timestamp.getTime()).not.toBeNaN();
  });

  it('should include version information', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    expect(body.version).toBeDefined();
    expect(typeof body.version).toBe('string');
  });

  it('should expose confirmation policy without secrets', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    expect(body.policy.confirmation).toEqual({
      network: 'Preview',
      confirmationMode: 'confirmed_only',
      minConfirmations: 1,
      maxTimeoutSeconds: 300,
      requireNonce: false,
    });
    expect(body.policy.signer).toEqual({
      mode: 'local-file',
      hotWallet: true,
    });
    expect(response.body).not.toContain('test-project-id');
    expect(response.body).not.toContain('test seed phrase');
  });
});
