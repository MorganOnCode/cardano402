import { z } from 'zod';

import { BLOCKFROST_URLS } from './types.js';
import type { CardanoNetwork } from './types.js';

/**
 * Chain configuration Zod schema.
 *
 * Validates Blockfrost settings, facilitator credentials, UTXO cache,
 * reservation system, and Redis connection parameters.
 *
 * SECURITY: `blockfrost.projectId`, `facilitator.seedPhrase`, and
 * `facilitator.privateKey` are sensitive fields. They must be provided
 * explicitly in config and must never appear in logs.
 */
export const ChainConfigSchema = z
  .object({
    network: z.enum(['Preview', 'Preprod', 'Mainnet']).default('Preview'),

    blockfrost: z.object({
      /** Blockfrost project ID (sensitive - network-specific, never log) */
      projectId: z.string().min(1, 'Blockfrost project ID is required'),
      /** Override URL (derived from network if not set) */
      url: z.string().url().optional(),
      /** API tier - affects caching aggressiveness */
      tier: z.enum(['free', 'paid']).default('free'),
    }),

    facilitator: z
      .object({
        /** Seed phrase for facilitator wallet (sensitive - never log) */
        seedPhrase: z.string().optional(),
        /** Private key for facilitator wallet (sensitive - never log) */
        privateKey: z.string().optional(),
      })
      .refine(
        (d) => d.seedPhrase || d.privateKey,
        'Either seedPhrase or privateKey must be provided'
      ),

    cache: z
      .object({
        /** UTXO cache TTL in seconds (roughly 3 Cardano blocks at 60s) */
        utxoTtlSeconds: z.number().int().min(10).max(300).default(60),
      })
      .default(() => ({ utxoTtlSeconds: 60 })),

    reservation: z
      .object({
        /** Reservation TTL in seconds (covers ~6 Cardano blocks) */
        ttlSeconds: z.number().int().min(30).max(600).default(120),
        /** Maximum concurrent UTXO reservations */
        maxConcurrent: z.number().int().min(1).max(100).default(20),
      })
      .default(() => ({ ttlSeconds: 120, maxConcurrent: 20 })),

    redis: z
      .object({
        host: z.string().default('127.0.0.1'),
        port: z.number().int().min(1).max(65535).default(6379),
        /** Redis password (sensitive - never log). Optional for local dev. */
        password: z.string().optional(),
        /** Redis username (Redis 6+ ACL). Optional. */
        username: z.string().optional(),
        /** Redis database number (0-15). Default 0. */
        db: z.number().int().min(0).max(15).default(0),
      })
      .default(() => ({ host: '127.0.0.1', port: 6379, db: 0 })),

    verification: z
      .object({
        /** Grace buffer in seconds for TTL check (default 30s per locked decision) */
        graceBufferSeconds: z.number().int().min(0).max(120).default(30),
        /** Default max timeout in seconds (default 300s = 5 min) */
        maxTimeoutSeconds: z.number().int().min(60).max(3600).default(300),
        /** Minimum acceptable fee in lovelace (sanity check lower bound) */
        feeMinLovelace: z.number().int().min(100000).max(500000).default(150000),
        /** Maximum acceptable fee in lovelace (sanity check upper bound) */
        feeMaxLovelace: z.number().int().min(1000000).max(10000000).default(5000000),
        /**
         * Whether `payload.nonce` is required by the verifier.
         * Per the x402 Cardano spec, nonces are MANDATORY. Default true.
         * Set to false to allow legacy clients during a migration window
         * (the verifier still validates structure if a nonce is supplied).
         */
        requireNonce: z.boolean().default(true),
        /**
         * Settlement confirmation mode for the `extensions.status` field on
         * the PAYMENT-RESPONSE / X-Payment-Response header.
         *
         *   - "confirmed_only" (default): only emit `status: confirmed` after
         *     block inclusion. Polling timeouts result in success=false.
         *   - "allow_mempool":  the operator opts into emitting
         *     `status: mempool` for transactions that submit but do not
         *     confirm before timeout. STRONGLY DISCOURAGED by the spec.
         *
         * Spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
         */
        confirmationMode: z.enum(['confirmed_only', 'allow_mempool']).default('confirmed_only'),
        /**
         * Minimum on-chain confirmations before a settled tx is reported
         * `confirmed`. Cardano Ouroboros Praos has probabilistic finality;
         * a single-block sighting CAN be rolled back at depth 1. Default 6
         * gives ~2 minutes of finality at the typical 20s slot, which is
         * the commonly-cited "near-final" threshold for Cardano.
         *
         * Operators that prioritize latency over rollback resistance can
         * lower this (e.g. to 1 for testnet smoke); operators handling
         * high-value flows should leave it at default or raise it.
         *
         * Set to 1 to preserve pre-PR-8 behavior (first sighting = confirmed).
         */
        minConfirmations: z.number().int().min(1).max(60).default(6),
      })
      .default(() => ({
        graceBufferSeconds: 30,
        maxTimeoutSeconds: 300,
        feeMinLovelace: 150000,
        feeMaxLovelace: 5000000,
        requireNonce: true,
        confirmationMode: 'confirmed_only' as const,
        minConfirmations: 6,
      })),
  })
  .superRefine((data, ctx) => {
    // Mainnet safety guardrail: require explicit MAINNET=true env var
    if (data.network === 'Mainnet' && process.env.MAINNET !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Mainnet connection requires explicit MAINNET=true environment variable',
        path: ['network'],
      });
    }
  });

export type ChainConfig = z.infer<typeof ChainConfigSchema>;

/**
 * Resolve the Blockfrost API URL for the given chain config.
 * Uses the explicit URL override if set, otherwise derives from the network.
 */
export function resolveBlockfrostUrl(config: ChainConfig): string {
  if (config.blockfrost.url) {
    return config.blockfrost.url;
  }
  return BLOCKFROST_URLS[config.network as CardanoNetwork];
}
