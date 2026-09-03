import type { FastifyInstance } from 'fastify';
import { describe, it, expect, afterEach, vi } from 'vitest';

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

function buildConfig(trustProxy: Config['server']['trustProxy']): Config {
  return {
    server: { host: '0.0.0.0', port: 0, trustProxy },
    logging: { level: 'error', pretty: false },
    rateLimit: { global: 100, windowMs: 60000, sensitive: 20 },
    env: 'test',
    metrics: {},
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
}

/**
 * `server.trustProxy` decides whether X-Forwarded-* headers are believed.
 * Since fastify 5.12.1 (GHSA-3m5p-2c4r-xxw2) that decision must be made per
 * connecting address, never by hop count, so these tests pin the behaviour
 * the facilitator relies on for rate limiting and logging: forwarded headers
 * are honoured only when the immediate peer is one of the configured proxies.
 */
describe('server.trustProxy', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function build(trustProxy: Config['server']['trustProxy']): Promise<FastifyInstance> {
    server = await createServer({ config: buildConfig(trustProxy) });
    // Test-only echo route so the resolved client address is observable.
    server.get('/__client-ip', async (request) => ({ ip: request.ip }));
    return server;
  }

  const forwarded = { 'x-forwarded-for': '203.0.113.9' };

  async function clientIpSeenFrom(s: FastifyInstance, remoteAddress: string): Promise<string> {
    const response = await s.inject({
      method: 'GET',
      url: '/__client-ip',
      remoteAddress,
      headers: forwarded,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { ip: string }).ip;
  }

  it('ignores X-Forwarded-For entirely when trustProxy is unset', async () => {
    const s = await build(undefined);

    expect(await clientIpSeenFrom(s, '127.0.0.1')).toBe('127.0.0.1');
  });

  it('honours X-Forwarded-For only when the connecting peer is a trusted address', async () => {
    const s = await build('loopback, uniquelocal');

    // Loopback nginx and a Docker-network peer are both in the trusted set.
    expect(await clientIpSeenFrom(s, '127.0.0.1')).toBe('203.0.113.9');
    expect(await clientIpSeenFrom(s, '172.18.0.2')).toBe('203.0.113.9');
    // A client that reaches the origin directly cannot spoof the chain.
    expect(await clientIpSeenFrom(s, '198.51.100.7')).toBe('198.51.100.7');
  });

  it('accepts an explicit array of proxy CIDRs', async () => {
    const s = await build(['10.0.0.0/8']);

    expect(await clientIpSeenFrom(s, '10.1.2.3')).toBe('203.0.113.9');
    expect(await clientIpSeenFrom(s, '127.0.0.1')).toBe('127.0.0.1');
  });
});
