import { describe, it, expect, vi } from 'vitest';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { WellKnownX402 } from '../src/catalog.js';
import { registerTools } from '../src/tools.js';
import type { CardanoSigner } from '../src/signer.js';

function makeServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

const STUB_SIGNER: CardanoSigner = {
  address: async () => 'addr_test1qx2sender',
  signPayment: vi.fn(),
};

const PREVIEW_ENDPOINT = {
  method: 'POST' as const,
  path: '/api/preview-thing',
  scheme: 'exact',
  network: 'cardano:preview',
  amount: '1000000',
  asset: 'lovelace',
  payTo: 'addr_test_preview',
  maxTimeoutSeconds: 600,
};

const MAINNET_ENDPOINT = {
  method: 'POST' as const,
  path: '/api/mainnet-thing',
  scheme: 'exact',
  network: 'cardano:mainnet',
  amount: '1000000',
  asset: 'lovelace',
  payTo: 'addr1_mainnet',
  maxTimeoutSeconds: 600,
};

function catalog(endpoints: unknown[], serverUrl = 'https://api.example.com'): WellKnownX402 {
  return {
    x402Version: 2 as const,
    server: { name: 's', url: serverUrl },
    endpoints,
  } as unknown as WellKnownX402;
}

describe('registerTools — mainnet gating', () => {
  it('drops mainnet endpoints by default', () => {
    const server = makeServer();
    const names = registerTools(server, {
      catalog: catalog([PREVIEW_ENDPOINT, MAINNET_ENDPOINT]),
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      signer: STUB_SIGNER,
    });
    expect(names).toEqual(['post_api_preview_thing']);
  });

  it('registers a mainnet endpoint when its derived name is in mainnetConfirmedTools', () => {
    const server = makeServer();
    const names = registerTools(server, {
      catalog: catalog([PREVIEW_ENDPOINT, MAINNET_ENDPOINT]),
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      signer: STUB_SIGNER,
      mainnetConfirmedTools: new Set(['post_api_mainnet_thing']),
    });
    expect(names.sort()).toEqual(['post_api_mainnet_thing', 'post_api_preview_thing']);
  });
});

describe('registerTools — SSRF gate on resolveBaseUrl', () => {
  it('rejects a catalog whose server.url is a private CIDR', () => {
    const server = makeServer();
    expect(() =>
      registerTools(server, {
        catalog: catalog([PREVIEW_ENDPOINT], 'http://169.254.169.254'),
        catalogUrl: 'https://api.example.com/.well-known/x402.json',
        signer: STUB_SIGNER,
      })
    ).toThrow(/private, loopback, or reserved/);
  });

  it('permits a private base URL when allowInsecure is set', () => {
    const server = makeServer();
    const names = registerTools(server, {
      catalog: catalog([PREVIEW_ENDPOINT], 'http://127.0.0.1:3000'),
      catalogUrl: 'https://api.example.com/.well-known/x402.json',
      signer: STUB_SIGNER,
      allowInsecure: true,
    });
    expect(names).toHaveLength(1);
  });
});

describe('registerTools — path validation', () => {
  it('rejects an endpoint whose path contains ..', () => {
    const server = makeServer();
    expect(() =>
      registerTools(server, {
        catalog: catalog([{ ...PREVIEW_ENDPOINT, path: '/api/../admin' }]),
        catalogUrl: 'https://api.example.com/.well-known/x402.json',
        signer: STUB_SIGNER,
      })
    ).toThrow(/parent-directory/);
  });

  it('rejects an endpoint whose path is an absolute URL', () => {
    const server = makeServer();
    expect(() =>
      registerTools(server, {
        catalog: catalog([{ ...PREVIEW_ENDPOINT, path: 'https://attacker.example/x' }]),
        catalogUrl: 'https://api.example.com/.well-known/x402.json',
        signer: STUB_SIGNER,
      })
    ).toThrow(/absolute URL/);
  });
});
