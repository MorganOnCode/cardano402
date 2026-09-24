import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          LIVE_DEMO_ENABLED: 'true',
          BLOCKFROST_PROJECT_ID: 'previewtest',
          DEMO_TESTNET_MNEMONIC: 'invalid test-only fixture',
        },
        serviceBindings: {
          FACILITATOR: async (request: Request) => {
            const body = (await request.json()) as {
              paymentPayload: { payload: { transaction: string } };
            };
            const transaction = body.paymentPayload.payload.transaction;
            return Response.json({
              success: transaction === 'persisted-signed-bytes',
              transaction: 'a'.repeat(64),
              network: 'cardano:preview',
              errorReason: 'settlement_pending',
            });
          },
        },
        outboundService: () => new Response('No real provider traffic in tests', { status: 599 }),
      },
    }),
  ],
});
