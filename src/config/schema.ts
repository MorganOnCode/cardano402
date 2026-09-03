import { isIP } from 'node:net';

import { z } from 'zod';

import { ChainConfigSchema, loadCredentialFile } from '../chain/config.js';

const DemoConfigSchema = z
  .object({
    /** Blockfrost project ID for demo (typically Preview testnet) */
    blockfrostProjectId: z.string().min(1),
    /** Seed phrase for demo wallet (Preview testnet wallet; sensitive - never log) */
    seedPhrase: z.string().optional(),
    /** Restrictive file containing the demo wallet seed phrase. */
    seedPhraseFile: z.string().optional(),
    /** Network for demo transactions */
    network: z.enum(['Preview', 'Preprod']).default('Preview'),
  })
  .superRefine((data, ctx) => {
    const sources = [data.seedPhrase, data.seedPhraseFile].filter(
      (value) => value !== undefined && value.trim() !== ''
    );
    if (sources.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either seedPhraseFile or seedPhrase must be provided',
      });
    }
    if (sources.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one demo seed source',
      });
    }
  })
  .transform(
    (
      data,
      ctx
    ): {
      blockfrostProjectId: string;
      seedPhrase: string;
      seedPhraseFile?: string;
      credentialSource: 'seedPhraseFile' | 'seedPhrase';
      network: 'Preview' | 'Preprod';
    } => {
      try {
        if (data.seedPhraseFile) {
          return {
            blockfrostProjectId: data.blockfrostProjectId,
            seedPhrase: loadCredentialFile(data.seedPhraseFile, 'demo.seedPhraseFile'),
            seedPhraseFile: data.seedPhraseFile,
            credentialSource: 'seedPhraseFile',
            network: data.network,
          };
        }
        return {
          blockfrostProjectId: data.blockfrostProjectId,
          seedPhrase: data.seedPhrase ?? '',
          credentialSource: 'seedPhrase',
          network: data.network,
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

/**
 * Error for a `server.trustProxy` value of the wrong shape entirely. Called
 * out explicitly because the most likely invalid value is a legacy numeric
 * hop count from an older config.example.json.
 */
const TRUST_PROXY_ERROR =
  'must be false, a trusted proxy address/CIDR (string, comma-separated), or an array of them; numeric hop counts are no longer supported since fastify 5.12.1 (GHSA-3m5p-2c4r-xxw2) because they never check the connecting address';

/** Named ranges understood by proxy-addr, the compiler behind Fastify's trustProxy. */
const TRUST_PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * True when `entry` is something proxy-addr accepts: a named range, an
 * IPv4/IPv6 address, or an address with a CIDR prefix. Checked here so a typo
 * fails as CONFIG_INVALID at load time instead of throwing from
 * `createServer()` after the config was accepted.
 */
function isTrustedProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_KEYWORDS.has(entry)) return true;
  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return false;
  if (slash === -1) return true;
  const prefix = entry.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function trustProxyEntryError(entry: unknown): string {
  return `invalid trusted-proxy entry ${JSON.stringify(entry)}: use "loopback", "linklocal", "uniquelocal", an IP address, or an IP/CIDR range such as "172.16.0.0/12"`;
}

/** Comma-separated form. Fastify trims each part, so validate the same way. */
const TrustProxyListSchema = z.string().superRefine((value, ctx) => {
  for (const part of value.split(',')) {
    const entry = part.trim();
    if (!isTrustedProxyEntry(entry)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: trustProxyEntryError(entry) });
    }
  }
});

/** Array form. Fastify passes it through untrimmed, so entries must be exact. */
const TrustProxyEntrySchema = z.string().refine(isTrustedProxyEntry, {
  error: (issue) => trustProxyEntryError(issue.input),
});

export const ConfigSchema = z
  .object({
    server: z
      .object({
        host: z.string().default('0.0.0.0'),
        port: z.number().int().min(1).max(65535).default(3000),
        /**
         * Trust X-Forwarded-* headers from the deployment reverse proxy.
         *
         * Accepts Fastify's `trustProxy` forms minus the numeric hop count:
         * `false` (default), a proxy-addr keyword or IP/CIDR (`"loopback"`,
         * `"127.0.0.1"`, `"172.16.0.0/12"`), a comma-separated list of those,
         * or an array of them. Entries are validated at load time so a typo
         * fails as CONFIG_INVALID rather than at server construction. Each
         * trusted hop is checked against the connecting address, so a client
         * that reaches the origin directly cannot spoof the forwarded chain.
         *
         * Numeric hop counts (`trustProxy: 2`) are rejected on purpose:
         * fastify 5.12.1 disabled them (GHSA-3m5p-2c4r-xxw2) because a hop
         * count never inspects the address, and since that release a number
         * silently trusts nothing. Boolean `true` is rejected in production.
         */
        trustProxy: z
          .union(
            [
              z.boolean(),
              TrustProxyListSchema,
              z.array(TrustProxyEntrySchema).min(1, {
                error: 'must list at least one trusted proxy entry, or use false',
              }),
            ],
            { error: TRUST_PROXY_ERROR }
          )
          .optional(),
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
        bearerToken: z.string().min(32).optional(),
      })
      .default(() => ({})),

    // Chain provider configuration (Blockfrost, network, cache, reservation, Redis)
    chain: ChainConfigSchema,

    // Demo configuration (optional -- separate testnet credentials for the live demo widget)
    demo: DemoConfigSchema.optional(),

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
      if (data.demo?.credentialSource === 'seedPhrase') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'demo.seedPhraseFile is required when config.env is "production". Keep demo wallet seed material out of config JSON.',
          path: ['demo', 'seedPhraseFile'],
        });
      }
      if (data.server.trustProxy === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'server.trustProxy must name the trusted proxy address(es) in production, not true. Use "loopback, uniquelocal" for a local reverse proxy or Docker-network peer, or an explicit IP/CIDR list.',
          path: ['server', 'trustProxy'],
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
