import { describe, expect, it } from 'vitest';

import { ServiceCatalog } from '../../src/catalog.js';

function makeCatalog(): ServiceCatalog {
  return new ServiceCatalog()
    .setServer({
      name: 'Example paid API',
      description: 'Test catalog',
      contact: 'https://example.com',
      url: 'https://api.example.com',
    })
    .setFacilitator({ url: 'https://fac.example.com' })
    .registerPaidRoute({
      method: 'POST',
      path: '/api/analyze',
      scheme: 'exact',
      network: 'cardano:mainnet',
      amount: '2000000',
      asset: 'lovelace',
      payTo: 'addr1...',
      maxTimeoutSeconds: 600,
      description: 'Analyse a document',
    });
}

describe('ServiceCatalog', () => {
  it('emits an x402.json shape with x402Version, server, endpoints, facilitator', () => {
    const out = makeCatalog().toX402Json();
    expect(out).toMatchObject({
      x402Version: 2,
      server: { name: 'Example paid API' },
      facilitator: 'https://fac.example.com',
    });
    expect((out.endpoints as unknown[]).length).toBe(1);
  });

  it('emits an A2A agent-card.json shape with capabilities', () => {
    const out = makeCatalog().toAgentCardJson();
    expect(out).toMatchObject({
      protocol: 'a2a/0.1',
      name: 'Example paid API',
      url: 'https://api.example.com',
    });
    expect((out.capabilities as unknown[]).length).toBe(1);
  });

  it('emits an ai-agent.json shape with paymentMethods and services', () => {
    const out = makeCatalog().toAiAgentJson();
    expect((out.paymentMethods as unknown[]).length).toBe(1);
    expect((out.services as unknown[]).length).toBe(1);
  });

  it('emits an MCP server-card.json shape with priced tools', () => {
    const out = makeCatalog().toMcpServerCardJson();
    expect((out.tools as unknown[]).length).toBe(1);
    const tool = (out.tools as Array<Record<string, unknown>>)[0];
    expect(tool.priced).toBe(true);
    expect(tool.method).toBe('POST');
    expect(tool.path).toBe('/api/analyze');
  });

  it('starts empty when no routes are registered', () => {
    const catalog = new ServiceCatalog();
    const x = catalog.toX402Json();
    expect((x.endpoints as unknown[]).length).toBe(0);
  });
});
