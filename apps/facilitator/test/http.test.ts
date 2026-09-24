import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

const app = () => exports.default as unknown as Fetcher;
const get = (path: string, headers: Record<string, string> = {}) =>
  app().fetch(`https://cardano402.test${path}`, { headers });
const post = (path: string, body: unknown) =>
  app().fetch(`https://cardano402.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

// First request pays vitest's one-off transform of the Cardano SDK graph.
beforeAll(async () => {
  await get('/health');
  await get('/supported');
}, 120_000);

describe('home view', () => {
  it('serves agents TOON with live kinds and next steps', async () => {
    const res = await get('/info');
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('service: cardano402');
    expect(text).toMatch(
      /kinds\[1\]\{x402Version,scheme,network,l1Confirmations\}:\n\s+2,exact,"cardano:preview",0\.\.20\n/
    );
    expect(text).toMatch(/\nhelp\[3\]:\n  Run `curl -s https:\/\/cardano402.test\/supported`/);
    expect(text).toContain('https://cardano402.test/supported');
  });

  it('serves browsers HTML', async () => {
    const res = await get('/info', { accept: 'text/html' });
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>cardano402</title>');
  });

  it('generates SKILL.md and llms.txt from the same data', async () => {
    const skill = await (await get('/SKILL.md')).text();
    expect(skill).toMatch(/^---\nname: cardano402\n/);
    expect(skill).toContain('cardano:preview');
    expect(await (await get('/llms.txt')).text()).toContain('https://cardano402.test/SKILL.md');
  });
});

describe('x402 facilitator endpoints', () => {
  it('advertises the exact scheme for the configured network, keyless', async () => {
    const body = (await (await get('/supported')).json()) as {
      kinds: { x402Version: number; scheme: string; network: string }[];
      signers: Record<string, string[]>;
    };
    expect(body.kinds).toEqual([
      expect.objectContaining({ x402Version: 2, scheme: 'exact', network: 'cardano:preview' }),
    ]);
    expect(Object.values(body.signers).flat()).toEqual([]);
  });

  it('rejects a body without payload or requirements', async () => {
    for (const path of ['/verify', '/settle']) {
      expect((await post(path, { x402Version: 2 })).status).toBe(400);
      expect((await post(path, 'not json')).status).toBe(400);
    }
  });

  it('rejects oversized bodies', async () => {
    const res = await post('/verify', {
      paymentPayload: { pad: 'x'.repeat(70_000) },
      paymentRequirements: {},
    });
    expect(res.status).toBe(413);
  });

  it('answers a malformed payment with isValid false, not a server error', async () => {
    const res = await post('/verify', {
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: { scheme: 'exact', network: 'cardano:preview' },
        payload: { transaction: 'bm90LWNib3I=', nonce: '00' },
      },
      paymentRequirements: {
        scheme: 'exact',
        network: 'cardano:preview',
        amount: '1000000',
        asset: 'lovelace',
        payTo: 'addr_test1vz0000000000000000000000000000000000000000000000000000',
        maxTimeoutSeconds: 300,
        extra: {},
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isValid: false });
  });

  it('reports shallow health without touching the provider', async () => {
    expect(await (await get('/health')).json()).toMatchObject({
      status: 'ok',
      network: 'cardano:preview',
    });
  });

  it('reports degraded deep health when the provider is unreachable', async () => {
    const res = await get('/health?deep=1');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'degraded', provider: 'down' });
  });

  it('returns a structured 404', async () => {
    const res = await get('/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ help: 'GET /info lists the endpoints' });
  });
});

describe('portfolio cost controls', () => {
  it('rejects mainnet before contacting a provider', async () => {
    const res = await post('/verify', {
      paymentPayload: { accepted: { network: 'cardano:mainnet' } },
      paymentRequirements: { network: 'cardano:mainnet' },
    });
    expect(res.status).toBe(400);
  });
});
