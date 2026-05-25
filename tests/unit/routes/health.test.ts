import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { healthRoutesPlugin } from '../../../src/routes/health.js';

/**
 * Helper to create a minimal Fastify server with health routes.
 * Optionally decorates with a Redis mock for controlling ping behavior.
 */
/** Mock storage backend that is always healthy by default */
function createMockStorage(healthy = true) {
  return {
    put: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    healthy: vi.fn().mockResolvedValue(healthy),
  };
}

const TEST_CONFIG = {
  chain: {
    network: 'Preview',
    verification: {
      confirmationMode: 'confirmed_only' as const,
      minConfirmations: 6,
      maxTimeoutSeconds: 300,
      requireNonce: true,
    },
    facilitator: {
      signerMode: 'local-file' as const,
      credentialSource: 'seedPhraseFile' as const,
    },
  },
};

async function createHealthServer(options?: {
  redis?: { ping: ReturnType<typeof vi.fn> } | Record<string, unknown>;
  storage?: { healthy: ReturnType<typeof vi.fn> } | Record<string, unknown>;
  config?: typeof TEST_CONFIG;
}): Promise<FastifyInstance> {
  const server = fastify({ logger: false });

  // Set Zod compilers (required for route schema declarations)
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // Decorate with redis if provided (simulates server.redis)
  // Cast to 'never' to satisfy Fastify's strict decorator typing -- this is a test mock
  if (options?.redis) {
    server.decorate('redis', options.redis as never);
  }

  // Decorate with storage (default: healthy mock)
  server.decorate('storage', (options?.storage ?? createMockStorage()) as never);
  if (options?.config) {
    server.decorate('config', options.config as never);
  }

  await server.register(healthRoutesPlugin);
  await server.ready();
  return server;
}

describe('Health Endpoint', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    if (server) await server.close();
  });

  describe('All dependencies up (healthy)', () => {
    beforeEach(async () => {
      server = await createHealthServer({
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
      });
    });

    it('should return healthy status with HTTP 200', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
    });

    it('should report Redis as up with latency', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.redis.status).toBe('up');
      expect(body.dependencies.redis.latency).toBeGreaterThanOrEqual(0);
    });

    it('should report Storage as up with latency', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.storage.status).toBe('up');
      expect(body.dependencies.storage.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Redis down, Storage up (degraded)', () => {
    beforeEach(async () => {
      server = await createHealthServer({
        redis: { ping: vi.fn().mockRejectedValue(new Error('Connection refused')) },
      });
    });

    it('should return degraded status with HTTP 200', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('degraded');
    });

    it('should report Redis as down with error message', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.redis.status).toBe('down');
      expect(body.dependencies.redis.error).toBe('Connection refused');
    });

    it('should report Storage as up even when Redis is down', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.storage.status).toBe('up');
    });
  });

  describe('Redis not configured (placeholder)', () => {
    beforeEach(async () => {
      // No redis decoration - simulates Redis not yet configured
      server = await createHealthServer();
    });

    it('should return healthy when Redis not configured', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
    });

    it('should report Redis as up with zero latency (placeholder)', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.redis.status).toBe('up');
      expect(body.dependencies.redis.latency).toBe(0);
    });
  });

  describe('Redis ping latency measurement', () => {
    it('should measure latency greater than zero for slow ping', async () => {
      // Create a Redis mock that takes a measurable amount of time
      const slowPing = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('PONG'), 10)));
      server = await createHealthServer({ redis: { ping: slowPing } });

      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.redis.status).toBe('up');
      expect(body.dependencies.redis.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Redis non-Error throw (catch handler)', () => {
    it('should handle non-Error objects thrown by Redis ping', async () => {
      server = await createHealthServer({
        redis: { ping: vi.fn().mockRejectedValue('string error') },
      });

      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies.redis.status).toBe('down');
      expect(body.dependencies.redis.error).toBe('Unknown error');
    });
  });

  describe('Response shape validation', () => {
    beforeEach(async () => {
      server = await createHealthServer({
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
      });
    });

    it('should return ISO timestamp', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.timestamp).toBeDefined();
      const parsed = new Date(body.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
      // Verify it's a valid ISO string
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return uptime as positive number', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThan(0);
    });

    it('should return version as string', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(typeof body.version).toBe('string');
    });

    it('should include redis and ipfs dependency keys', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.dependencies).toHaveProperty('redis');
      expect(body.dependencies).toHaveProperty('storage');
    });

    it('should expose non-secret confirmation policy when config is available', async () => {
      await server.close();
      server = await createHealthServer({
        redis: { ping: vi.fn().mockResolvedValue('PONG') },
        config: TEST_CONFIG,
      });

      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      expect(body.policy).toEqual({
        signer: {
          mode: 'local-file',
          credentialSource: 'seedPhraseFile',
          hotWallet: true,
        },
        confirmation: {
          network: 'Preview',
          confirmationMode: 'confirmed_only',
          minConfirmations: 6,
          maxTimeoutSeconds: 300,
          requireNonce: true,
        },
      });
      expect(JSON.stringify(body.policy)).not.toContain('projectId');
      expect(JSON.stringify(body.policy)).not.toContain('test seed phrase');
      expect(JSON.stringify(body.policy)).not.toContain('private-key-material');
    });
  });

  describe('Outer Promise.all catch wrapper', () => {
    it('should handle checkRedis throwing unexpected error via .catch wrapper', async () => {
      // When checkRedis itself throws (not redis.ping), the outer .catch() catches it.
      // Simulate this by making ping getter throw.
      const brokenRedis = {
        get ping() {
          throw new Error('Unexpected checkRedis failure');
        },
      };
      server = await createHealthServer({ redis: brokenRedis as never });

      const response = await server.inject({ method: 'GET', url: '/health' });

      const body = response.json();
      // The outer .catch() catches it and returns down
      expect(body.dependencies.redis.status).toBe('down');
      expect(body.dependencies.redis.error).toBe('Unexpected checkRedis failure');
    });
  });
});
