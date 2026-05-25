// POST /verify route -- exposes the verification pipeline via HTTP.
//
// Validates the request body with Zod, assembles a VerifyContext from the
// parsed request plus server state, calls verifyPayment(), and returns the
// result. All responses are HTTP 200 except truly unexpected server errors.
//
// CALLER TRUST CONTRACT (audit H2):
//   The `paymentRequirements` field in the request body comes from the
//   CALLER (typically a resource server). The facilitator does NOT and
//   CANNOT distinguish caller-server-controlled requirements from
//   echoed-client-input requirements. A resource server that naïvely
//   forwards an inbound client body to this endpoint is vulnerable to
//   the attacker substituting their own `payTo`/`amount` and getting
//   `isValid: true` against a 1-lovelace self-transfer.
//
//   `paymentRequirements` MUST be server-side configuration.
//   See README.md "Trust model" and docs/open-posture.md
//   "What /verify attests" for the full discussion.

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

import type { CardanoNetwork } from '../chain/types.js';
import { resolveAssetTransferMethod } from '../sdk/methods.js';
import { verifyScript } from '../verify/methods/script.js';
import { parseNonce } from '../verify/nonce.js';
import {
  FacilitatorRequestEnvelopeSchema,
  normaliseFacilitatorRequest,
} from '../verify/request-shape.js';
import { VerifyResponseSchema, CAIP2_CHAIN_IDS } from '../verify/types.js';
import type { VerifyContext } from '../verify/types.js';
import { verifyPayment } from '../verify/verify-payment.js';

const verifyRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.post(
    '/verify',
    {
      schema: {
        description:
          'Verify a Cardano payment transaction against payment requirements. ' +
          'Accepts either {paymentPayload: object} or {paymentHeader: base64} body shape.',
        tags: ['Facilitator'],
        body: FacilitatorRequestEnvelopeSchema,
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
      // 1. Parse the envelope, accepting either the cardano402 paymentPayload
      //    object form or the base x402 paymentHeader base64 string form.
      const envelope = FacilitatorRequestEnvelopeSchema.safeParse(request.body);

      if (!envelope.success) {
        return reply.status(200).send({
          isValid: false,
          invalidReason: 'invalid_request',
          invalidMessage: 'Request body does not match expected format',
          extensions: {
            errors: envelope.error.issues.map((issue) => issue.message),
          },
        });
      }

      const normalised = normaliseFacilitatorRequest(envelope.data);
      if (!normalised.ok) {
        // Keep the public reason `invalid_request` for any malformed request,
        // and surface the granular kind via extensions.errorKind for callers
        // that want to disambiguate.
        return reply.status(200).send({
          isValid: false,
          invalidReason: 'invalid_request',
          invalidMessage: normalised.error.message,
          extensions: {
            errorKind: normalised.error.kind,
            errors:
              normalised.error.kind === 'invalid_payload'
                ? normalised.error.issues.map((i) => i.message)
                : [normalised.error.message],
          },
        });
      }

      // 2. Assemble VerifyContext from parsed request + server state
      const { paymentPayload, paymentRequirements } = normalised.data;
      const chainConfig = fastify.config.chain;
      const verificationConfig = chainConfig.verification;

      // Parse the spec-mandated nonce if present. We deliberately accept the
      // raw payload here rather than rejecting at the schema level so that
      // the route can return a structured CheckResult-shaped failure.
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

      // 3. Branch on assetTransferMethod and call the matching verifier.
      const method = resolveAssetTransferMethod(
        paymentRequirements.extra as Record<string, unknown> | undefined
      );

      if (method === 'unknown') {
        return reply.status(200).send({
          isValid: false,
          invalidReason: 'method_not_supported',
          invalidMessage:
            'paymentRequirements.extra.assetTransferMethod is not recognised. Use "default" for address-to-address payments.',
        });
      }

      try {
        let result;
        switch (method) {
          case 'script':
            result = await verifyScript(ctx, fastify.log);
            break;
          case 'default':
          default:
            result = await verifyPayment(ctx, fastify.log);
            break;
        }

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
