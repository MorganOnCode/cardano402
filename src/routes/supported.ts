// GET /supported route -- returns facilitator capabilities (PROT-03).
//
// Reports supported chains, schemes, and signer addresses per the x402 V2 spec.
// Resource servers call this to discover what the facilitator supports.

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

import type { CardanoNetwork } from '../chain/types.js';
import type { SupportedResponse } from '../sdk/types.js';
import { SupportedResponseSchema } from '../sdk/types.js';
import { CAIP2_CHAIN_IDS } from '../verify/types.js';

const supportedRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get(
    '/supported',
    {
      schema: {
        description:
          'Query facilitator capabilities: supported chains, schemes, and signer addresses',
        tags: ['Health'],
        response: {
          200: SupportedResponseSchema,
          500: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    async (_request, reply) => {
      const chainConfig = fastify.config.chain;
      const network = CAIP2_CHAIN_IDS[chainConfig.network as CardanoNetwork];

      // Get the facilitator's wallet address for the signer list
      let signerAddress: string;
      try {
        signerAddress = await fastify.chainProvider.getAddress();
      } catch (error) {
        fastify.log.error(
          { err: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to derive facilitator address'
        );
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to derive facilitator address',
        });
      }

      const response: SupportedResponse = {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network,
          },
        ],
        extensions: [],
        signers: {
          // CAIP family pattern per V2 spec (cardano:* matches all Cardano networks)
          'cardano:*': [signerAddress],
        },
      };

      return reply.status(200).send(response);
    }
  );

  done();
};

export const supportedRoutesPlugin = fp(supportedRoutes, {
  name: 'supported-routes',
  fastify: '5.x',
});
