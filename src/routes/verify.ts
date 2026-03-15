// POST /verify route -- exposes the verification pipeline via HTTP.
//
// Validates the request body with Zod, assembles a VerifyContext from the
// parsed request plus server state, calls verifyPayment(), and returns the
// result. All responses are HTTP 200 except truly unexpected server errors.

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

import type { CardanoNetwork } from '../chain/types.js';
import { VerifyRequestSchema, VerifyResponseSchema, CAIP2_CHAIN_IDS } from '../verify/types.js';
import type { VerifyContext } from '../verify/types.js';
import { verifyPayment } from '../verify/verify-payment.js';

const verifyRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.post(
    '/verify',
    {
      schema: {
        description: 'Verify a Cardano payment transaction against payment requirements',
        tags: ['Facilitator'],
        body: VerifyRequestSchema,
        response: {
          200: VerifyResponseSchema,
          500: z.object({ error: z.string(), message: z.string() }),
        },
      },
      attachValidation: true,
      config: {
        rateLimit: {
          max: fastify.config.rateLimit.sensitive,
          timeWindow: fastify.config.rateLimit.windowMs,
        },
      },
    },
    async (request, reply) => {
      // 1. Parse and validate request body with Zod (handler-level, not Fastify schema)
      const parsed = VerifyRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(200).send({
          isValid: false,
          invalidReason: 'invalid_request',
          invalidMessage: 'Request body does not match expected format',
          extensions: {
            errors: parsed.error.issues.map((issue) => issue.message),
          },
        });
      }

      // 2. Assemble VerifyContext from parsed request + server state
      const { paymentPayload, paymentRequirements } = parsed.data;
      const chainConfig = fastify.config.chain;
      const verificationConfig = chainConfig.verification;

      const ctx: VerifyContext = {
        scheme: paymentRequirements.scheme,
        network: paymentRequirements.network,
        payTo: paymentRequirements.payTo,
        requiredAmount: BigInt(paymentRequirements.amount),
        maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
        asset: paymentRequirements.asset,
        transactionCbor: paymentPayload.payload.transaction,
        payerAddress: paymentPayload.payload.payer,
        requestedAt: Date.now(),
        getCurrentSlot: () => fastify.chainProvider.getCurrentSlot(),
        getMinUtxoLovelace: (numAssets: number) =>
          fastify.chainProvider.getMinUtxoLovelace(numAssets),
        configuredNetwork: CAIP2_CHAIN_IDS[chainConfig.network as CardanoNetwork],
        feeMin: BigInt(verificationConfig.feeMinLovelace),
        feeMax: BigInt(verificationConfig.feeMaxLovelace),
      };

      // 3. Call verification pipeline
      try {
        const result = await verifyPayment(ctx, fastify.log);

        // 4. Return result as HTTP 200
        return reply.status(200).send(result);
      } catch (error) {
        // 5. Unexpected errors (CML WASM crash, etc.) -- HTTP 500
        fastify.log.error(
          { err: error instanceof Error ? error.message : 'Unknown error' },
          'Unexpected error during payment verification'
        );
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred during verification',
        });
      }
    }
  );

  done();
};

export const verifyRoutesPlugin = fp(verifyRoutes, {
  name: 'verify-routes',
  fastify: '5.x',
});
