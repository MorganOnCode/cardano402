import { readFileSync, statSync } from 'node:fs';

import { z } from 'zod';

import { BLOCKFROST_URLS } from './types.js';
import type { CardanoNetwork } from './types.js';

/**
 * Chain configuration Zod schema.
 *
 * Validates Blockfrost settings, facilitator credentials, UTXO cache,
 * reservation system, and Redis connection parameters.
 *
 * SECURITY: `blockfrost.projectId`, facilitator signing material, and Redis
 * credentials are sensitive fields. They must never appear in logs. Mainnet
 * signing material should be loaded from restrictive files rather than stored
 * inline in config JSON.
 */
function loadCredentialFile(path: string, label: string): string {
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a regular file: ${path}`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be group/world readable or writable: ${path}`);
  }
  const value = readFileSync(path, 'utf8').trim();
  if (!value) {
    throw new Error(`${label} is empty: ${path}`);
  }
  return value;
}

const FacilitatorConfigSchema = z
  .object({
    /**
     * Root facilitator signer mode.
     *
     * `local-file` is the only implemented mode today: the process loads
     * signing material from config or restrictive files and initializes a
     * local Lucid wallet. Remote policy signing is intentionally not accepted
     * until a signer provider boundary exists.
     */
    signerMode: z.literal('local-file').default('local-file'),
    /** Seed phrase for facilitator wallet (sensitive - never log) */
    seedPhrase: z.string().optional(),
    /** Restrictive file containing seed phrase for facilitator wallet. */
    seedPhraseFile: z.string().optional(),
    /** Private key for facilitator wallet (sensitive - never log) */
    privateKey: z.string().optional(),
    /** Restrictive file containing private key for facilitator wallet. */
    privateKeyFile: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const sources = [
      data.seedPhrase,
      data.seedPhraseFile,
      data.privateKey,
      data.privateKeyFile,
    ].filter((v) => v !== undefined && v.trim() !== '');
    if (sources.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Either seedPhraseFile, privateKeyFile, seedPhrase, or privateKey must be provided',
      });
    }
    if (sources.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one facilitator credential source',
      });
    }
  })
  .transform(
    (
      data,
      ctx
    ): {
      seedPhrase?: string;
      privateKey?: string;
      signerMode?: 'local-file';
      credentialSource?: 'seedPhraseFile' | 'privateKeyFile' | 'seedPhrase' | 'privateKey';
    } => {
      try {
        if (data.seedPhraseFile) {
          return {
            seedPhrase: loadCredentialFile(data.seedPhraseFile, 'chain.facilitator.seedPhraseFile'),
            signerMode: data.signerMode,
            credentialSource: 'seedPhraseFile' as const,
          };
        }
        if (data.privateKeyFile) {
          return {
            privateKey: loadCredentialFile(data.privateKeyFile, 'chain.facilitator.privateKeyFile'),
            signerMode: data.signerMode,
            credentialSource: 'privateKeyFile' as const,
          };
        }
        if (data.seedPhrase) {
          return {
            seedPhrase: data.seedPhrase,
            signerMode: data.signerMode,
            credentialSource: 'seedPhrase' as const,
          };
        }
        return {
          privateKey: data.privateKey,
          signerMode: data.signerMode,
          credentialSource: 'privateKey' as const,
        };
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : String(error),
        });
        return z.NEVER;
      }
    }
  );

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

    facilitator: FacilitatorConfigSchema,

    cache: z
      .object({
        /** UTXO cache TTL in seconds (roughly 3 Cardano blocks at 60s) */
        utxoTtlSeconds: z.number().int().min(10).max(300).default(60),
      })
      .default(() => ({ utxoTtlSeconds: 60 })),

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
    if (
      data.network === 'Mainnet' &&
      (data.facilitator.credentialSource === 'seedPhrase' ||
        data.facilitator.credentialSource === 'privateKey') &&
      process.env.CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY !== 'true'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Mainnet facilitator signing material must use seedPhraseFile or privateKeyFile. Set CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY=true only if you intentionally accept inline hot key material in config JSON.',
        path: ['facilitator'],
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
