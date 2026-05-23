import type { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';
import { createServer } from '../../src/server.js';

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

describe('Landing page', () => {
  let server: FastifyInstance;

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

  it('serves index.html at / with viewport meta', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.body).toContain('<div id="root"></div>');
    // Required for any sane mobile rendering
    expect(response.body).toMatch(/<meta\s+name="viewport"[^>]*width=device-width/i);
  });

  it('ships responsive @media rules so the layout adapts on mobile', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    // At least one mobile breakpoint must exist; guards against the responsive
    // CSS being accidentally stripped during a future refactor.
    expect(response.body).toMatch(/@media\s*\(\s*max-width:\s*900px\s*\)/);
    expect(response.body).toMatch(/@media\s*\(\s*max-width:\s*480px\s*\)/);
    // The mobile drawer toggle is part of the responsive nav; if it disappears,
    // the page is back to a desktop-only nav with no hamburger.
    expect(response.body).toContain('nav-burger');
    expect(response.body).toContain('nav-drawer');
  });

  it('references the precompiled landing bundle (drops Babel-in-browser)', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    // The new architecture loads a single precompiled bundle
    expect(response.body).toMatch(/<script\s+src="\/dist\/app\.js"[^>]*defer/);
  });

  it('does NOT load Babel standalone or any unpkg.com script (drops unsafe-eval)', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });

    // Reverting to Babel-in-browser would force `unsafe-eval` back into the CSP.
    expect(response.body).not.toContain('@babel/standalone');
    expect(response.body).not.toContain('unpkg.com');
    expect(response.body).not.toMatch(/type=["']text\/babel["']/);
  });

  it('ships a strict CSP without unsafe-eval and without third-party script sources', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });

    const csp = response.headers['content-security-policy'];
    expect(csp, 'CSP header should be set in non-dev env').toBeDefined();
    const cspStr = String(csp);
    // Hardened: the script-src directive must not allow eval or unpkg.com
    expect(cspStr).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(cspStr).not.toMatch(/script-src[^;]*unpkg\.com/);
    // 'self' must still be present so /dist/app.js loads
    expect(cspStr).toMatch(/script-src[^;]*'self'/);
  });
});
