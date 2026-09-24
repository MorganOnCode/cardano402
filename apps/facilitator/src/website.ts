interface WebsiteBindings {
  PREVIEW: Fetcher;
}

// Static assets are served before this handler. Workers Routes (not Custom
// Domains) let fetch(request) reach the existing tunnel origin for every API.
export default {
  async fetch(request: Request, env: WebsiteBindings): Promise<Response> {
    if (new URL(request.url).pathname === '/demo/run') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
        });
      }
      // Reuse the deployed preview's rate limits, wallet, receipt and quotas.
      // Never forward a visitor body or credentials to the demo service.
      return env.PREVIEW.fetch('https://preview.internal/demo/run', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') ?? 'unknown' },
      });
    }
    return fetch(request);
  },
};
