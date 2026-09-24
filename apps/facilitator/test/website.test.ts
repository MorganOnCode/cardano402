import { afterEach, describe, expect, it, vi } from 'vitest';
import website from '../src/website';

afterEach(() => vi.restoreAllMocks());

describe('staged website cutover', () => {
  it.each(['/verify', '/settle', '/supported', '/health', '/.well-known/x402.json', '/info'])(
    'preserves the original request to the mainnet origin: %s',
    async (path) => {
      const response = new Response('mainnet response');
      const origin = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      const preview = vi.fn();
      const request = new Request(`https://cardano402.com${path}?original=1`, {
        method: 'POST',
        headers: { Authorization: 'test-value' },
        body: 'unchanged payment payload',
      });
      expect(
        await website.fetch(request, { PREVIEW: { fetch: preview } as unknown as Fetcher })
      ).toBe(response);
      expect(origin).toHaveBeenCalledWith(request);
      expect(preview).not.toHaveBeenCalled();
      expect(await request.text()).toBe('unchanged payment payload');
    }
  );

  it('sends only a bodyless demo request through existing preview limits', async () => {
    const origin = vi.spyOn(globalThis, 'fetch');
    const response = Response.json({ state: 'confirmed', cached: true });
    const preview = vi.fn().mockResolvedValue(response);
    const request = new Request('https://www.cardano402.com/demo/run?recipient=attacker', {
      method: 'POST',
      headers: { Authorization: 'discard-me', 'CF-Connecting-IP': '192.0.2.1' },
      body: 'discard-me',
    });
    expect(
      await website.fetch(request, { PREVIEW: { fetch: preview } as unknown as Fetcher })
    ).toBe(response);
    expect(preview).toHaveBeenCalledWith('https://preview.internal/demo/run', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '192.0.2.1' },
    });
    expect(origin).not.toHaveBeenCalled();
  });

  it('does not trigger a demo on GET', async () => {
    const preview = vi.fn();
    const response = await website.fetch(new Request('https://cardano402.com/demo/run'), {
      PREVIEW: { fetch: preview } as unknown as Fetcher,
    });
    expect(response.status).toBe(405);
    expect(preview).not.toHaveBeenCalled();
  });
});
