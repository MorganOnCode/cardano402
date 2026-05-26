// POST /settle route -- exposes the settlement orchestrator via HTTP.
//
// Validates the request body with Zod, assembles a VerifyContext from the
// parsed request plus server state, calls settlePayment(), and returns the
// result. Aligned with x402 V2 spec (same request shape as /verify).
//
// CALLER TRUST CONTRACT (audit H2):
//   Same model as /verify -- `paymentRequirements` MUST be server-side
//   config, NEVER echoed client input. Settlement only attests the
//   tx satisfies the supplied requirements; it cannot tell whether
//   those requirements came from the resource server's price-list or
//   the attacker's request body. See README.md "Trust model".

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

import type { CardanoNetwork } from '../chain/types.js';
import { resolveAssetTransferMethod } from '../sdk/methods.js';
import { settlePayment } from '../settle/settle-payment.js';
import { SettleResponseSchema } from '../settle/types.js';
import { decodeTransactionCborBase64 } from '../verify/cbor.js';
import { parseNonce } from '../verify/nonce.js';
import {
  FacilitatorRequestEnvelopeSchema,
  normaliseFacilitatorRequest,
} from '../verify/request-shape.js';
import { CAIP2_CHAIN_IDS } from '../verify/types.js';
import type { VerifyContext } from '../verify/types.js';

const settleRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.post(
    '/settle',
    {
      schema: {
        description:
          'Submit a signed Cardano transaction for on-chain settlement. ' +
          'Accepts either {paymentPayload: object} or {paymentHeader: base64} body shape.',
        tags: ['Facilitator'],
        body: FacilitatorRequestEnvelopeSchema,
        response: {
          200: SettleResponseSchema,
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
      const chainConfig = fastify.config.chain;
      const network = CAIP2_CHAIN_IDS[chainConfig.network as CardanoNetwork];

      // 1. Parse the envelope and accept either body shape (Track A3).
      const envelope = FacilitatorRequestEnvelopeSchema.safeParse(request.body);

      if (!envelope.success) {
        return reply.status(200).send({
          success: false,
          transaction: '',
          network,
          errorReason: 'invalid_request',
          errorMessage: 'Request body does not match expected format',
        });
      }

      const normalised = normaliseFacilitatorRequest(envelope.data);
      if (!normalised.ok) {
        return reply.status(200).send({
          success: false,
          transaction: '',
          network,
          errorReason: 'invalid_request',
          errorMessage: normalised.error.message,
        });
      }

      // 2. Assemble VerifyContext from parsed request + server state
      const { paymentPayload, paymentRequirements } = normalised.data;
      const verificationConfig = chainConfig.verification;

      if (paymentRequirements.maxTimeoutSeconds > verificationConfig.maxTimeoutSeconds) {
        return reply.status(200).send({
          success: false,
          transaction: '',
          network,
          errorReason: 'invalid_request',
          errorMessage:
            'paymentRequirements.maxTimeoutSeconds exceeds the configured verification maximum',
        });
      }

      const declaredNonce = paymentPayload.payload.nonce
        ? (parseNonce(paymentPayload.payload.nonce) ?? undefined)
        : undefined;

      const ctx: VerifyContext = {
        scheme: paymentRequirements.scheme,
        network: paymentRequirements.network,
        payTo: paymentRequirements.payTo,
        requiredAmount: BigInt(paymentRequirements.amount),
        maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
        ttlGraceBufferSeconds: verificationConfig.graceBufferSeconds,
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
        // Spec-mandated nonce hooks (Track A1)
        declaredNonce,
        requireNonce: verificationConfig.requireNonce,
        isUtxoUnspent: (txHash: string, index: number) =>
          fastify.chainProvider.blockfrostClient.isUtxoUnspent(txHash, index),
      };

      // 3. Convert base64 transaction to Uint8Array for submission
      let cborBytes: Uint8Array;
      try {
        cborBytes = decodeTransactionCborBase64(paymentPayload.payload.transaction);
      } catch (error) {
        return reply.status(200).send({
          success: false,
          transaction: '',
          network,
          errorReason: 'invalid_request',
          errorMessage: error instanceof Error ? error.message : 'Invalid transaction CBOR',
        });
      }

      // Only the default address-to-address method can be settled today.
      const method = resolveAssetTransferMethod(
        paymentRequirements.extra as Record<string, unknown> | undefined
      );
      if (method !== 'default') {
        const reason = method === 'unknown' ? 'method_not_supported' : 'method_not_implemented';
        return reply.status(200).send({
          success: false,
          transaction: '',
          network,
          errorReason: reason,
          errorMessage: 'Only assetTransferMethod="default" is settled by this facilitator.',
        });
      }

      // 5. Call settlement orchestrator
      try {
        const result = await settlePayment(
          ctx,
          cborBytes,
          fastify.chainProvider.blockfrostClient,
          fastify.redis,
          network,
          fastify.log,
          {
            allowMempool: verificationConfig.confirmationMode === 'allow_mempool',
            minConfirmations: verificationConfig.minConfirmations,
          }
        );

        // 6. Return result as HTTP 200
        return reply.status(200).send(result);
      } catch (error) {
        // 7. Unexpected errors -- HTTP 500
        fastify.log.error(
          { err: error instanceof Error ? error.message : 'Unknown error' },
          'Unexpected error during settlement'
        );
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred during settlement',
        });
      }
    }
  );

  done();
};

export const settleRoutesPlugin = fp(settleRoutes, {
  name: 'settle-routes',
  fastify: '5.x',
});
