import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ConfigSchema } from '../../src/config/schema.js';
import { createServer } from '../../src/server.js';

// Mock the chain layer to avoid Redis connection requirements
vi.mock('../../src/chain/index.js', () => ({
  createRedisClient: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
  createChainProvider: () => ({}),
  disconnectRedis: vi.fn(),
}));

describe('Security Controls', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    // Config with very tight limits for testing
    const config = ConfigSchema.parse({
      env: 'test',
      server: { port: 3000 },
      logging: { level: 'fatal' }, // quiet
      rateLimit: {
        global: 10,
        windowMs: 1000,
        sensitive: 1,
      },
      chain: {
        network: 'Preview',
        blockfrost: { projectId: 'test' },
        facilitator: { seedPhrase: 'test test test test test test test test test test test test' },
      },
    });

    server = await createServer({ config });
    await server.ready();
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it('should enforce rate limits', async () => {
    // Exhaust the rate limit (max 10)
    for (let i = 0; i < 10; i++) {
      const res = await server.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }

    // Request 11: Rate Limited
    const r11 = await server.inject({ method: 'GET', url: '/health' });
    expect(r11.statusCode).toBe(429);
    expect(r11.json()).toMatchObject({
      error: {
        statusCode: 429,
        // message changes based on windowMs
        message: 'Rate limit exceeded, retry in 1 second',
      },
    });
  }, 10000); // increase timeout just in case

  it('should enforce tighter rate limits on /verify than global', async () => {
    // Config sets sensitive: 1 -- so after 1 request, the 2nd should be 429
    const res1 = await server.inject({ method: 'POST', url: '/verify', payload: {} });
    // First request goes through (returns 200 with validation error -- that's fine)
    expect(res1.statusCode).toBeLessThan(429);

    const res2 = await server.inject({ method: 'POST', url: '/verify', payload: {} });
    expect(res2.statusCode).toBe(429);
  });

  it('should enforce tighter rate limits on /settle than global', async () => {
    const res1 = await server.inject({ method: 'POST', url: '/settle', payload: {} });
    expect(res1.statusCode).toBeLessThan(429);

    const res2 = await server.inject({ method: 'POST', url: '/settle', payload: {} });
    expect(res2.statusCode).toBe(429);
  });

  it('should enforce tighter rate limits on /status than global', async () => {
    const res1 = await server.inject({ method: 'POST', url: '/status', payload: {} });
    expect(res1.statusCode).toBeLessThan(429);

    const res2 = await server.inject({ method: 'POST', url: '/status', payload: {} });
    expect(res2.statusCode).toBe(429);
  });

  it('should enforce tighter rate limits on /demo/run than global', async () => {
    const res1 = await server.inject({ method: 'POST', url: '/demo/run', payload: {} });
    expect(res1.statusCode).not.toBe(429);

    const res2 = await server.inject({ method: 'POST', url: '/demo/run', payload: {} });
    expect(res2.statusCode).toBe(429);
  });

  it('should allow /health at global rate limit (not sensitive)', async () => {
    // /health should still work at global rate (10), not sensitive (1)
    const res1 = await server.inject({ method: 'GET', url: '/health' });
    expect(res1.statusCode).toBe(200);

    const res2 = await server.inject({ method: 'GET', url: '/health' });
    expect(res2.statusCode).toBe(200); // Still under global limit of 10
  });

  it('should enforce body size limits', async () => {
    const largePayload = 'a'.repeat(51201); // 50KB + 1 byte

    const response = await server.inject({
      method: 'POST',
      url: '/verify', // Any POST route
      payload: { data: largePayload },
    });

    expect(response.statusCode).toBe(413); // Payload Too Large
    expect(response.json()).toMatchObject({
      error: {
        statusCode: 413,
        code: 'FST_ERR_CTP_BODY_TOO_LARGE',
      },
    });
  });
});
