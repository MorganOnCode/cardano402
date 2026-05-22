import { describe, it, expect, vi } from 'vitest';

import {
  Cardano402HttpError,
  Cardano402NetworkError,
  Cardano402ValidationError,
} from '@cardano402/core';

import {
  WellKnownX402Schema,
  fetchCatalog,
  resolveBaseUrl,
  toolNameFor,
} from '../src/catalog.js';

const VALID_CATALOG = {
  x402Version: 2,
  server: { name: 'cardano402 server', url: 'https://api.example.com' },
  endpoints: [
    {
      method: 'POST',
      path: '/api/analyze',
      scheme: 'exact',
      network: 'cardano:preview',
      amount: '2000000',
      asset: 'lovelace',
      payTo: 'addr_test1qx2fxv2',
      maxTimeoutSeconds: 600,
      description: 'Analyse a document',
    },
  ],
  facilitator: 'https://fac.example.com',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('toolNameFor', () => {
  // The producer (root repo `src/catalog.ts`) and the consumer (this
  // package) must agree on tool names. These cases lock the recipe.
  it.each([
    [{ method: 'POST' as const, path: '/api/analyze' }, 'post_api_analyze'],
    [{ method: 'GET' as const, path: '/files/:cid' }, 'get_files_cid'],
    [{ method: 'POST' as const, path: '/upload' }, 'post_upload'],
    [{ method: 'PUT' as const, path: '/a/b-c.d' }, 'put_a_b_c_d'],
    [{ method: 'DELETE' as const, path: '/' }, 'delete_'],
  ])('maps %o to %s', (endpoint, expected) => {
    expect(toolNameFor(endpoint)).toBe(expected);
  });
});

describe('WellKnownX402Schema', () => {
  it('accepts a well-formed catalog', () => {
    expect(WellKnownX402Schema.safeParse(VALID_CATALOG).success).toBe(true);
  });

  it('rejects a catalog with the wrong x402Version', () => {
    const bad = { ...VALID_CATALOG, x402Version: 1 };
    expect(WellKnownX402Schema.safeParse(bad).success).toBe(false);
  });

  it('passes unknown fields through (forward compat)', () => {
    const withExtra = { ...VALID_CATALOG, someFutureField: 'ok' };
    const parsed = WellKnownX402Schema.parse(withExtra);
    expect((parsed as Record<string, unknown>).someFutureField).toBe('ok');
  });
});

describe('resolveBaseUrl', () => {
  it('prefers server.url when present', () => {
    expect(
      resolveBaseUrl(
        { ...VALID_CATALOG, server: { name: 'x', url: 'https://api.example.com/' } } as never,
        'https://catalog.example.com/.well-known/x402.json'
      )
    ).toBe('https://api.example.com');
  });

  it('falls back to the catalog URL origin', () => {
    expect(
      resolveBaseUrl(
        { ...VALID_CATALOG, server: undefined } as never,
        'https://api.example.com/.well-known/x402.json'
      )
    ).toBe('https://api.example.com');
  });
});

describe('fetchCatalog', () => {
  it('returns a parsed catalog on a 200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_CATALOG));
    const result = await fetchCatalog('https://api.example.com/.well-known/x402.json', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.endpoints).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws Cardano402HttpError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('not found', { status: 404, statusText: 'Not Found' })
    );
    await expect(
      fetchCatalog('https://api.example.com/.well-known/x402.json', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Cardano402HttpError);
  });

  it('throws Cardano402ValidationError on schema mismatch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ x402Version: 1 }));
    await expect(
      fetchCatalog('https://api.example.com/.well-known/x402.json', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Cardano402ValidationError);
  });

  it('throws Cardano402NetworkError when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      fetchCatalog('https://api.example.com/.well-known/x402.json', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Cardano402NetworkError);
  });
});
