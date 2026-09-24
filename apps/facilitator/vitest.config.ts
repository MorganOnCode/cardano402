import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { BLOCKFROST_PROJECT_ID: 'preprodtest' },
        // Tests never reach a real chain provider.
        outboundService: () => new Response('outbound blocked in tests', { status: 599 }),
      },
    }),
  ],
});
