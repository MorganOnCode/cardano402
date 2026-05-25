import { z } from 'zod';

import { ChainConfigSchema } from '../chain/config.js';

export const ConfigSchema = z
  .object({
    server: z
      .object({
        host: z.string().default('0.0.0.0'),
        port: z.number().int().min(1).max(65535).default(3000),
      })
      .default(() => ({ host: '0.0.0.0', port: 3000 })),

    logging: z
      .object({
        level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
        pretty: z.boolean().default(false),
      })
      .default(() => ({ level: 'info' as const, pretty: false })),

    // Optional Sentry integration
    sentry: z
      .object({
        dsn: z.string().url(),
        environment: z.string().default('development'),
        tracesSampleRate: z.number().min(0).max(1).default(0.1),
      })
      .optional(),

    // Environment mode
    env: z.enum(['development', 'production', 'test']).default('development'),

    // Rate limiting configuration
    rateLimit: z
      .object({
        global: z.number().int().min(1).default(100),
        sensitive: z.number().int().min(1).default(20),
        windowMs: z.number().int().min(1000).default(60000),
      })
      .default(() => ({ global: 100, sensitive: 20, windowMs: 60000 })),

    // Metrics endpoint access control
    metrics: z
      .object({
        /** Bearer token required for GET /metrics when set. Required in production. */
        bearerToken: z.string().min(16).optional(),
      })
      .default(() => ({})),

    // Chain provider configuration (Blockfrost, network, cache, reservation, Redis)
    chain: ChainConfigSchema,

    // Demo configuration (optional -- separate testnet credentials for the live demo widget)
    demo: z
      .object({
        /** Blockfrost project ID for demo (typically Preview testnet) */
        blockfrostProjectId: z.string().min(1),
        /** Seed phrase for demo wallet (Preview testnet wallet) */
        seedPhrase: z.string().min(1),
        /** Network for demo transactions */
        network: z.enum(['Preview', 'Preprod']).default('Preview'),
      })
      .optional(),

    // Storage backend configuration (optional -- defaults to filesystem)
    storage: z
      .object({
        /** Storage backend type */
        backend: z.enum(['fs', 'ipfs']).default('fs'),
        /** Filesystem backend options */
        fs: z
          .object({
            /** Directory for stored files (default: ./data/files) */
            dataDir: z.string().default('./data/files'),
          })
          .default(() => ({ dataDir: './data/files' })),
        /** IPFS backend options */
        ipfs: z
          .object({
            /** IPFS Kubo HTTP API URL (default: http://localhost:5001) */
            apiUrl: z.string().url().default('http://localhost:5001'),
          })
          .default(() => ({ apiUrl: 'http://localhost:5001' })),
      })
      .default(() => ({
        backend: 'fs' as const,
        fs: { dataDir: './data/files' },
        ipfs: { apiUrl: 'http://localhost:5001' },
      })),
  })
  .superRefine((data, ctx) => {
    // Production-mode redis password guardrail. The docs/vps-deployment.md
    // runbook says Redis MUST be password-protected in production, but the
    // chain.redis.password schema is `optional()` to support the no-auth
    // dev compose. Enforce the production requirement here so an operator
    // can't accidentally deploy with config.env="production" and an empty
    // Redis password. Mirrors the MAINNET=true guardrail pattern in chain/config.ts.
    if (data.env === 'production') {
      const pwd = data.chain.redis.password;
      if (!pwd || pwd.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'chain.redis.password is required when config.env is "production". ' +
            'Set REDIS_PASSWORD in .env and chain.redis.password in config.json.',
          path: ['chain', 'redis', 'password'],
        });
      }
      const metricsToken = data.metrics.bearerToken;
      if (!metricsToken || metricsToken.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'metrics.bearerToken is required when config.env is "production" to protect /metrics.',
          path: ['metrics', 'bearerToken'],
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
