import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        serviceBindings: {
          DEMO: () => Response.json({ state: 'confirmed', network: 'cardano:preview' }),
        },
        bindings: { BLOCKFROST_PROJECT_ID: 'previewtest', LIVE_DEMO_ENABLED: 'true' },
        // Tests never reach a real chain provider.
        outboundService: () => new Response('outbound blocked in tests', { status: 599 }),
      },
    }),
  ],
});
