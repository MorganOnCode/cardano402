import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';

// Mock Lucid Evolution packages to prevent native module loading (libsodium)
vi.mock('@lucid-evolution/lucid', () => ({
  Lucid: vi.fn().mockResolvedValue({
    selectWallet: { fromSeed: vi.fn(), fromPrivateKey: vi.fn() },
    newTx: vi.fn(),
    config: vi.fn(),
    wallet: vi.fn().mockReturnValue({
      address: vi
        .fn()
        .mockResolvedValue(
          'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7'
        ),
    }),
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
// Test config
// ---------------------------------------------------------------------------

const testConfig: Config = {
  server: { host: '0.0.0.0', port: 0 },
  logging: { level: 'error', pretty: false },
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
    },
  },
  storage: {
    backend: 'fs' as const,
    fs: { dataDir: './data/files' },
    ipfs: { apiUrl: 'http://localhost:5001' },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /files/:cid Route', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: testConfig });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    // Reset storage mock for each test
    server.storage.put = vi.fn();
    server.storage.get = vi.fn().mockResolvedValue(null);
    server.storage.has = vi.fn().mockResolvedValue(false);
    server.storage.healthy = vi.fn().mockResolvedValue(true);
  });

  // ---- Successful download ----

  describe('Successful download', () => {
    it('should return 200 with file data when content exists', async () => {
      const fileContent = Buffer.from('hello world');
      (server.storage.has as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (server.storage.get as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent);

      const response = await server.inject({
        method: 'GET',
        url: '/files/abc123def456',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('hello world');
    });

    it('should set Content-Type to application/octet-stream', async () => {
      const fileContent = Buffer.from('binary data');
      (server.storage.has as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (server.storage.get as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent);

      const response = await server.inject({
        method: 'GET',
        url: '/files/abc123def456',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['content-length']).toBe(String(fileContent.length));
    });
  });

  // ---- Not found ----

  describe('Not found', () => {
    it('should return 404 for non-existent content', async () => {
      (server.storage.has as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const response = await server.inject({
        method: 'GET',
        url: '/files/nonexistent123',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return error body with "Not Found"', async () => {
      (server.storage.has as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const response = await server.inject({
        method: 'GET',
        url: '/files/nonexistent123',
      });

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Content not found');
    });
  });

  // ---- Edge cases ----

  describe('Edge cases', () => {
    it('should return 500 when storage backend throws error', async () => {
      (server.storage.has as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (server.storage.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Storage read failed')
      );

      const response = await server.inject({
        method: 'GET',
        url: '/files/abc123def456',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Internal Server Error');
    });

    it('should not require payment for downloads (no 402)', async () => {
      // Even without any payment headers, download should not return 402
      (server.storage.has as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (server.storage.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.from('free content')
      );

      const response = await server.inject({
        method: 'GET',
        url: '/files/abc123def456',
        // Intentionally no Payment-Signature header
      });

      expect(response.statusCode).not.toBe(402);
      expect(response.statusCode).toBe(200);
    });
  });
});
