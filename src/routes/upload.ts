// POST /upload route -- payment-gated file storage (reference implementation).
//
// Flow: client sends multipart file -> payment gate verifies/settles ->
// file stored to backend -> CID returned.
//
// Requirements: STOR-01 (gated upload), STOR-02 (returns CID), SECU-04 (settle-then-work)

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

// Import for type augmentation -- adds request.file() to FastifyRequest
import '@fastify/multipart';

import type { CardanoNetwork } from '../chain/types.js';
import { FacilitatorClient } from '../sdk/facilitator-client.js';
import { createPaymentGate } from '../sdk/payment-gate.js';
import { CAIP2_CHAIN_IDS } from '../verify/types.js';

const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024; // 10MB

const uploadRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  // Create FacilitatorClient pointing to ourselves (same-process facilitator)
  const facilitatorBaseUrl = `http://${fastify.config.server.host === '0.0.0.0' ? '127.0.0.1' : fastify.config.server.host}:${fastify.config.server.port}`;
  // Use 150s timeout — settle endpoint polls for confirmation up to 120s on testnet
  const facilitator = new FacilitatorClient({ baseUrl: facilitatorBaseUrl, timeout: 150_000 });

  const chainConfig = fastify.config.chain;
  const network = CAIP2_CHAIN_IDS[chainConfig.network as CardanoNetwork];

  // TODO: Make upload price configurable in config.json. Fixed at 2 ADA for v1.
  const uploadPrice = '2000000'; // 2 ADA in lovelace

  // Create payment gate for the upload route
  // The facilitator address will be resolved asynchronously on first request
  let paymentGateHandler: ReturnType<typeof createPaymentGate> | null = null;

  const ensurePaymentGate = async (): Promise<ReturnType<typeof createPaymentGate>> => {
    if (paymentGateHandler) return paymentGateHandler;

    const facilitatorAddress = await fastify.chainProvider.getAddress();
    paymentGateHandler = createPaymentGate({
      facilitator,
      payTo: facilitatorAddress,
      amount: uploadPrice,
      network,
      description: 'File upload to x402 storage',
      mimeType: 'application/octet-stream',
    });

    return paymentGateHandler;
  };

  fastify.post(
    '/upload',
    {
      schema: {
        description: 'Upload a file with x402 payment (Payment-Signature header required)',
        tags: ['Storage'],
        response: {
          200: z.object({
            success: z.literal(true),
            cid: z.string(),
            size: z.number(),
          }),
          400: z.object({ error: z.string(), message: z.string() }),
          402: z.object({
            x402Version: z.literal(2),
            error: z.string().nullable(),
            resource: z.object({
              description: z.string(),
              mimeType: z.string(),
              url: z.string(),
            }),
            accepts: z.array(
              z.object({
                scheme: z.string(),
                network: z.string(),
                amount: z.string(),
                payTo: z.string(),
              })
            ),
          }),
          500: z.object({ error: z.string(), message: z.string() }),
        },
      },
      config: {
        rateLimit: {
          max: fastify.config.rateLimit.sensitive,
          timeWindow: fastify.config.rateLimit.windowMs,
        },
      },
      bodyLimit: UPLOAD_BODY_LIMIT,
    },
    async (request, reply) => {
      // 1. Run payment gate (settle-before-execution per SECU-04)
      const gate = await ensurePaymentGate();
      // The gate is an async preHandlerHookHandler. Its TypeScript signature
      // includes (this, request, reply, done), but the async implementation
      // returns a Promise and never calls done. We await the returned promise
      // directly, passing a no-op done to satisfy the type.
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- async hook ignores done
      await gate.call(fastify, request, reply, () => {});

      // If the payment gate sent a reply (402 or error), stop here
      if (reply.sent) {
        return;
      }

      // 2. Parse multipart file upload
      let fileData: Buffer;
      try {
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'No file provided. Send a multipart/form-data request with a "file" field.',
          });
        }
        fileData = await data.toBuffer();
      } catch (error) {
        fastify.log.error(
          { err: error instanceof Error ? error.message : 'Unknown error' },
          'File upload parsing failed'
        );
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Failed to parse file upload',
        });
      }

      // 3. Store file (after settlement is confirmed -- SECU-04)
      try {
        const cid = await fastify.storage.put(fileData);

        fastify.log.info({ cid, size: fileData.length }, 'File stored successfully');

        return reply.status(200).send({
          success: true,
          cid,
          size: fileData.length,
        });
      } catch (error) {
        fastify.log.error(
          { err: error instanceof Error ? error.message : 'Unknown error' },
          'File storage failed'
        );
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to store file',
        });
      }
    }
  );

  done();
};

export const uploadRoutesPlugin = fp(uploadRoutes, {
  name: 'upload-routes',
  fastify: '5.x',
});
