import { describe, it, expect, vi, afterEach } from 'vitest';

import type { CatalogEndpoint, WellKnownX402 } from '../src/catalog.js';
import { startCardano402Mcp } from '../src/server.js';
import type { CardanoSigner } from '../src/signer.js';

const STUB_SIGNER: CardanoSigner = {
  address: async () => 'addr_test1qx2sender',
  signPayment: vi.fn(),
};

const STUB_CATALOG: WellKnownX402 = {
  x402Version: 2 as const,
  server: { name: 's', url: 'https://api.example.com' },
  endpoints: [] as CatalogEndpoint[],
};

const STRONG_HTTP_TOKEN = '0123456789abcdef0123456789abcdef';

function stubFetchCatalog(): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(STUB_CATALOG), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  ) as unknown as typeof fetch;
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe('startCardano402Mcp — HTTP transport hardening', () => {
  it('binds to 127.0.0.1 by default', async () => {
    const handle = await startCardano402Mcp({
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      transport: 'http' as const,
      httpPort: 0,
      listenHost: '127.0.0.1',
      httpOriginAllowlist: [],
      network: 'Preview' as const,
      blockfrostKey: 'preview1234567890',
      signer: { type: 'seed' as const, seedPhrase: 'a b c' },
      requestTimeoutMs: 5000,
      allowInsecure: false,
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      mainnetConfirmedTools: [],
      signerOverride: STUB_SIGNER,
      fetchImpl: stubFetchCatalog(),
      log: () => undefined,
    });
    cleanup = handle.stop;
    expect(handle.httpHost).toBe('127.0.0.1');
  });

  it('refuses to start on 0.0.0.0 without a bearer token', async () => {
    await expect(
      startCardano402Mcp({
        catalogUrl: 'https://api.example.com/.well-known/x402.json',
        transport: 'http' as const,
        httpPort: 0,
        listenHost: '0.0.0.0',
        httpOriginAllowlist: [],
        network: 'Preview' as const,
        blockfrostKey: 'preview1234567890',
        signer: { type: 'seed' as const, seedPhrase: 'a b c' },
        requestTimeoutMs: 5000,
        allowInsecure: false,
        maxAmountPerCall: 5_000_000n,
        maxAmountPerDay: 50_000_000n,
        mainnetConfirmedTools: [],
        signerOverride: STUB_SIGNER,
        fetchImpl: stubFetchCatalog(),
        log: () => undefined,
      })
    ).rejects.toThrow(/bearer-token|http-bearer-token/);
  });

  it('refuses short bearer tokens even when options bypass config parsing', async () => {
    await expect(
      startCardano402Mcp({
        catalogUrl: 'https://api.example.com/.well-known/x402.json',
        transport: 'http' as const,
        httpPort: 0,
        listenHost: '127.0.0.1',
        httpOriginAllowlist: [],
        httpBearerToken: 'short-token',
        network: 'Preview' as const,
        blockfrostKey: 'preview1234567890',
        signer: { type: 'seed' as const, seedPhrase: 'a b c' },
        requestTimeoutMs: 5000,
        allowInsecure: false,
        maxAmountPerCall: 5_000_000n,
        maxAmountPerDay: 50_000_000n,
        mainnetConfirmedTools: [],
        signerOverride: STUB_SIGNER,
        fetchImpl: stubFetchCatalog(),
        log: () => undefined,
      })
    ).rejects.toThrow(/at least 32 characters/);
  });

  it('rejects requests with a foreign Origin header', async () => {
    const handle = await startCardano402Mcp({
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      transport: 'http' as const,
      httpPort: 0,
      listenHost: '127.0.0.1',
      httpOriginAllowlist: [],
      network: 'Preview' as const,
      blockfrostKey: 'preview1234567890',
      signer: { type: 'seed' as const, seedPhrase: 'a b c' },
      requestTimeoutMs: 5000,
      allowInsecure: false,
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      mainnetConfirmedTools: [],
      signerOverride: STUB_SIGNER,
      fetchImpl: stubFetchCatalog(),
      log: () => undefined,
    });
    cleanup = handle.stop;
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('forbidden_origin');
  });

  it('accepts requests with a loopback Origin header', async () => {
    const handle = await startCardano402Mcp({
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      transport: 'http' as const,
      httpPort: 0,
      listenHost: '127.0.0.1',
      httpOriginAllowlist: [],
      network: 'Preview' as const,
      blockfrostKey: 'preview1234567890',
      signer: { type: 'seed' as const, seedPhrase: 'a b c' },
      requestTimeoutMs: 5000,
      allowInsecure: false,
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      mainnetConfirmedTools: [],
      signerOverride: STUB_SIGNER,
      fetchImpl: stubFetchCatalog(),
      log: () => undefined,
    });
    cleanup = handle.stop;
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'http://localhost',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    });
    // Either a 200/SSE handshake or a transport-specific status, but NOT
    // a 403/401 — that's the only thing this assertion guarantees.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('rejects requests without a matching bearer token when one is configured', async () => {
    const handle = await startCardano402Mcp({
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      transport: 'http' as const,
      httpPort: 0,
      listenHost: '127.0.0.1',
      httpOriginAllowlist: [],
      httpBearerToken: STRONG_HTTP_TOKEN,
      network: 'Preview' as const,
      blockfrostKey: 'preview1234567890',
      signer: { type: 'seed' as const, seedPhrase: 'a b c' },
      requestTimeoutMs: 5000,
      allowInsecure: false,
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      mainnetConfirmedTools: [],
      signerOverride: STUB_SIGNER,
      fetchImpl: stubFetchCatalog(),
      log: () => undefined,
    });
    cleanup = handle.stop;
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('accepts requests with the matching bearer token', async () => {
    const handle = await startCardano402Mcp({
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      transport: 'http' as const,
      httpPort: 0,
      listenHost: '127.0.0.1',
      httpOriginAllowlist: [],
      httpBearerToken: STRONG_HTTP_TOKEN,
      network: 'Preview' as const,
      blockfrostKey: 'preview1234567890',
      signer: { type: 'seed' as const, seedPhrase: 'a b c' },
      requestTimeoutMs: 5000,
      allowInsecure: false,
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      mainnetConfirmedTools: [],
      signerOverride: STUB_SIGNER,
      fetchImpl: stubFetchCatalog(),
      log: () => undefined,
    });
    cleanup = handle.stop;
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${STRONG_HTTP_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    });
    expect(res.status).not.toBe(401);
  });

  it('rejects bearer headers with extra whitespace in the token value', async () => {
    const handle = await startCardano402Mcp({
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      transport: 'http' as const,
      httpPort: 0,
      listenHost: '127.0.0.1',
      httpOriginAllowlist: [],
      httpBearerToken: STRONG_HTTP_TOKEN,
      network: 'Preview' as const,
      blockfrostKey: 'preview1234567890',
      signer: { type: 'seed' as const, seedPhrase: 'a b c' },
      requestTimeoutMs: 5000,
      allowInsecure: false,
      maxAmountPerCall: 5_000_000n,
      maxAmountPerDay: 50_000_000n,
      mainnetConfirmedTools: [],
      signerOverride: STUB_SIGNER,
      fetchImpl: stubFetchCatalog(),
      log: () => undefined,
    });
    cleanup = handle.stop;
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${STRONG_HTTP_TOKEN} extra`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
