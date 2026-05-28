// Config + CLI parsing for @cardano402/mcp-server.
//
// Sources, in precedence: CLI flags > environment variables > defaults.
// All fields are validated through a Zod schema before reaching the runtime,
// so callers can rely on the parsed config being well-formed.

import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';

import { z } from 'zod';

export const TransportSchema = z.enum(['stdio', 'http']);
export type Transport = z.infer<typeof TransportSchema>;

export const LucidNetworkSchema = z.enum(['Preview', 'Preprod', 'Mainnet']);
export type LucidNetwork = z.infer<typeof LucidNetworkSchema>;

export const SignerConfigSchema = z.object({
  type: z.literal('seed'),
  seedPhrase: z.string().min(1),
});
export type SignerConfig = z.infer<typeof SignerConfigSchema>;

// Defaults chosen to be conservative — 5 ADA per call, 50 ADA per day. They
// only matter on Mainnet (Preview/Preprod ADA is worthless) but they apply
// uniformly so that local-test regressions in the cap logic show up before
// they can hit Mainnet. Operators can raise either ceiling via CLI/env.
const DEFAULT_MAX_PER_CALL_LOVELACE = 5_000_000n;
const DEFAULT_MAX_PER_DAY_LOVELACE = 50_000_000n;

// bigint-friendly zod helper: accept string | number | bigint, store as bigint.
const BigintAmountSchema = z
  .union([z.bigint(), z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const n = typeof v === 'bigint' ? v : BigInt(v);
      if (n < 0n) {
        ctx.addIssue({ code: 'custom', message: 'amount must be non-negative' });
        return z.NEVER;
      }
      return n;
    } catch {
      ctx.addIssue({ code: 'custom', message: `not a valid integer amount: ${String(v)}` });
      return z.NEVER;
    }
  });

export const McpServerConfigSchema = z.object({
  catalogUrl: z.string().url(),
  transport: TransportSchema.default('stdio'),
  httpPort: z.number().int().min(1).max(65535).default(3333),
  /** Network interface for the HTTP transport. Defaults to loopback. */
  listenHost: z.string().default('127.0.0.1'),
  /** Optional bearer token required on every HTTP transport request. */
  httpBearerToken: z.string().min(32).optional(),
  /** Optional Origin allowlist for HTTP transport. Empty/undefined → loopback only. */
  httpOriginAllowlist: z.array(z.string()).default([]),
  network: LucidNetworkSchema.default('Preview'),
  blockfrostKey: z.string().min(1),
  signer: SignerConfigSchema,
  requestTimeoutMs: z.number().int().min(1000).max(120_000).default(60_000),
  allowInsecure: z.boolean().default(false),
  /** Per-call hard cap on the lovelace amount the signer will sign. */
  maxAmountPerCall: BigintAmountSchema.default(DEFAULT_MAX_PER_CALL_LOVELACE),
  /** Rolling 24h cap on the lovelace amount the signer will sign. */
  maxAmountPerDay: BigintAmountSchema.default(DEFAULT_MAX_PER_DAY_LOVELACE),
  /** If set, refuse to sign to addresses outside this list. */
  payToAllowlist: z.array(z.string().min(1)).optional(),
  /**
   * Amount in lovelace above which an MCP elicitation/create confirmation is
   * requested before signing. Defaults to maxAmountPerCall so every signing
   * that hits the per-call cap requires explicit confirmation, but the
   * threshold can be lowered to require confirmation on smaller amounts too.
   */
  elicitationThresholdAmount: BigintAmountSchema.optional(),
  /**
   * Names of tools (matching the catalog-derived tool name, e.g. `post_api_x`)
   * that may be registered even when their catalog network is cardano:mainnet.
   * Any mainnet tool not in this list is dropped at registerTools time.
   */
  mainnetConfirmedTools: z.array(z.string().min(1)).default([]),
  spendStorePath: z.string().min(1).optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Map a CAIP-2 cardano network id (e.g. "cardano:mainnet") to the
 * Lucid Evolution `Network` enum value.
 *
 * Returns `null` when the id is not recognised — callers should fall back
 * to the explicit `--network` flag or leave the default.
 */
export function lucidNetworkFromCaip2(caip2: string): LucidNetwork | null {
  const [chain, net] = caip2.toLowerCase().split(':');
  if (chain !== 'cardano') return null;
  if (net === 'mainnet') return 'Mainnet';
  if (net === 'preprod') return 'Preprod';
  if (net === 'preview') return 'Preview';
  return null;
}

export interface RawArgs {
  catalog?: string;
  transport?: string;
  port?: string;
  listenHost?: string;
  network?: string;
  maxAmountPerCall?: string;
  maxAmountPerDay?: string;
  payToAllowlist?: string;
  mainnetConfirmedTools?: string;
  httpBearerToken?: string;
  httpOriginAllowlist?: string;
  elicitationThreshold?: string;
  spendStorePath?: string;
  seedPhraseFile?: string;
  help?: boolean;
}

/**
 * Minimal argv parser. Only walks the flags we accept and ignores positionals
 * so we never accidentally pull in a CLI parser dependency.
 */
export function parseArgs(argv: readonly string[]): RawArgs {
  const out: RawArgs = {};
  const FLAG_KEYS: Record<string, keyof RawArgs> = {
    '--catalog': 'catalog',
    '--transport': 'transport',
    '--port': 'port',
    '--listen-host': 'listenHost',
    '--network': 'network',
    '--max-amount-per-call': 'maxAmountPerCall',
    '--max-amount-per-day': 'maxAmountPerDay',
    '--pay-to-allowlist': 'payToAllowlist',
    '--mainnet-confirmed-tools': 'mainnetConfirmedTools',
    '--http-bearer-token': 'httpBearerToken',
    '--http-origin-allowlist': 'httpOriginAllowlist',
    '--elicitation-threshold': 'elicitationThreshold',
    '--spend-store-path': 'spendStorePath',
    '--seed-phrase-file': 'seedPhraseFile',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    const direct = FLAG_KEYS[arg];
    if (direct !== undefined) {
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      (out as Record<string, string>)[direct as string] = next;
      i += 1;
      continue;
    }
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx);
      const val = arg.slice(eqIdx + 1);
      const target = FLAG_KEYS[key];
      if (target !== undefined) (out as Record<string, string>)[target as string] = val;
    }
  }
  return out;
}

export interface LoadConfigInput {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '[::1]' ||
  host === '::1';

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function loadSeedPhraseFromFile(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`SEED_PHRASE_FILE is not a regular file: ${path}`);
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error(
        `SEED_PHRASE_FILE must not be group/world readable or writable: ${path}`
      );
    }
    const seedPhrase = readFileSync(fd, 'utf8').trim();
    if (!seedPhrase) {
      throw new Error(`SEED_PHRASE_FILE is empty: ${path}`);
    }
    return seedPhrase;
  } finally {
    closeSync(fd);
  }
}

/**
 * Resolve a fully-validated config from CLI args + environment.
 *
 * Throws on the following hard errors:
 *  - missing `--catalog` / `CARDANO402_CATALOG_URL`
 *  - missing `BLOCKFROST_KEY` or seed phrase source
 *  - non-HTTPS catalog URL pointing at a non-loopback host, unless
 *    `--allow-insecure` / `CARDANO402_ALLOW_INSECURE=true` is set
 *  - `Mainnet` network without explicit `MAINNET=true`
 */
export function loadConfig(input: LoadConfigInput = {}): McpServerConfig {
  const env = input.env ?? process.env;
  const args = parseArgs(input.argv ?? []);

  const catalogUrl = args.catalog ?? env.CARDANO402_CATALOG_URL;
  if (!catalogUrl) {
    throw new Error(
      'catalog URL is required (--catalog <url> or CARDANO402_CATALOG_URL=<url>)'
    );
  }

  const blockfrostKey = env.BLOCKFROST_KEY;
  if (!blockfrostKey) {
    throw new Error('BLOCKFROST_KEY environment variable is required');
  }

  const seedPhraseFile = args.seedPhraseFile ?? env.SEED_PHRASE_FILE;
  const seedPhrase = seedPhraseFile ? loadSeedPhraseFromFile(seedPhraseFile) : env.SEED_PHRASE;
  if (!seedPhrase) {
    throw new Error(
      'seed phrase is required (SEED_PHRASE_FILE/--seed-phrase-file preferred, or SEED_PHRASE for testnet)'
    );
  }

  const allowInsecure =
    env.CARDANO402_ALLOW_INSECURE === 'true' || env.CARDANO402_ALLOW_INSECURE === '1';

  if (!allowInsecure) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(catalogUrl);
    } catch (err) {
      throw new Error(`catalog URL is not a valid URL: ${(err as Error).message}`);
    }
    if (parsedUrl.protocol !== 'https:' && !isLoopbackHost(parsedUrl.hostname)) {
      throw new Error(
        `catalog URL '${catalogUrl}' is not HTTPS. ` +
          `Set CARDANO402_ALLOW_INSECURE=true if you really mean to send signed ` +
          `transactions over cleartext.`
      );
    }
  }

  const network: LucidNetwork = args.network
    ? LucidNetworkSchema.parse(args.network)
    : env.CARDANO402_NETWORK
      ? LucidNetworkSchema.parse(env.CARDANO402_NETWORK)
      : 'Preview';

  if (network === 'Mainnet' && env.MAINNET !== 'true') {
    throw new Error(
      'Mainnet connection requires explicit MAINNET=true environment variable'
    );
  }

  const httpPort = args.port ? Number.parseInt(args.port, 10) : undefined;
  if (httpPort !== undefined && Number.isNaN(httpPort)) {
    throw new Error(`--port must be an integer, got '${args.port}'`);
  }

  const listenHost = args.listenHost ?? env.CARDANO402_LISTEN_HOST;
  const httpBearerToken = args.httpBearerToken ?? env.MCP_HTTP_BEARER_TOKEN;

  const originAllowlistRaw =
    args.httpOriginAllowlist ?? env.MCP_HTTP_ORIGIN_ALLOWLIST;
  const httpOriginAllowlist = originAllowlistRaw ? parseCsv(originAllowlistRaw) : undefined;

  const maxAmountPerCall =
    args.maxAmountPerCall ?? env.CARDANO402_MAX_AMOUNT_PER_CALL;
  const maxAmountPerDay =
    args.maxAmountPerDay ?? env.CARDANO402_MAX_AMOUNT_PER_DAY;

  const payToAllowlistRaw =
    args.payToAllowlist ?? env.CARDANO402_PAY_TO_ALLOWLIST;
  const payToAllowlist = payToAllowlistRaw ? parseCsv(payToAllowlistRaw) : undefined;

  const mainnetConfirmedToolsRaw =
    args.mainnetConfirmedTools ?? env.CARDANO402_MAINNET_CONFIRMED_TOOLS;
  const mainnetConfirmedTools = mainnetConfirmedToolsRaw
    ? parseCsv(mainnetConfirmedToolsRaw)
    : undefined;

  const elicitationThresholdAmount =
    args.elicitationThreshold ?? env.CARDANO402_ELICITATION_THRESHOLD;
  const spendStorePath = args.spendStorePath ?? env.CARDANO402_SPEND_STORE_PATH;

  if (network === 'Mainnet' && !spendStorePath) {
    throw new Error(
      'Mainnet connection requires CARDANO402_SPEND_STORE_PATH or --spend-store-path so spend caps persist across restarts'
    );
  }

  if (
    network === 'Mainnet' &&
    !seedPhraseFile &&
    env.CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV !== 'true'
  ) {
    throw new Error(
      'Mainnet signing requires SEED_PHRASE_FILE or --seed-phrase-file. Set CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV=true only if you intentionally accept hot seed material in process environment.'
    );
  }

  return McpServerConfigSchema.parse({
    catalogUrl,
    transport: args.transport,
    httpPort,
    listenHost,
    httpBearerToken,
    httpOriginAllowlist,
    network,
    blockfrostKey,
    signer: { type: 'seed', seedPhrase },
    allowInsecure,
    maxAmountPerCall,
    maxAmountPerDay,
    payToAllowlist,
    mainnetConfirmedTools,
    elicitationThresholdAmount,
    spendStorePath,
  });
}

export function helpText(): string {
  return [
    'Usage: cardano402-mcp [options]',
    '',
    'Options:',
    '  --catalog <url>                URL of /.well-known/x402.json (or set CARDANO402_CATALOG_URL)',
    '  --transport <name>             "stdio" (default) or "http"',
    '  --port <n>                     HTTP transport port (default 3333)',
    '  --listen-host <host>           HTTP listen host (default 127.0.0.1; use 0.0.0.0 ONLY with --http-bearer-token)',
    '  --network <name>               Preview | Preprod | Mainnet (default Preview)',
    '  --max-amount-per-call <lovelace>',
    '                                 Hard cap per signed transaction (default 5_000_000 = 5 ADA)',
    '  --max-amount-per-day <lovelace>',
    '                                 Rolling 24h cap on signed amount (default 50_000_000 = 50 ADA)',
    '  --pay-to-allowlist <a,b,c>     Refuse to sign to addresses outside this comma-separated list',
    '  --mainnet-confirmed-tools <a,b,c>',
    '                                 Only register these tools when the catalog network is cardano:mainnet',
    '  --http-bearer-token <token>    Require Authorization: Bearer <token> on every HTTP transport request (min 32 chars)',
    '  --http-origin-allowlist <a,b,c>',
    '                                 Additional Origin header values to accept (loopback is always allowed)',
    '  --elicitation-threshold <lovelace>',
    '                                 Trigger MCP elicitation/create before signing if amount > threshold',
    '                                 (default = --max-amount-per-call so every cap-hit is confirmed)',
    '  --spend-store-path <path>       Persist rolling spend history to this JSON file',
    '  --seed-phrase-file <path>       Read signing wallet seed phrase from a 0600 file (required for Mainnet by default)',
    '  -h, --help                     Show this help',
    '',
    'Environment:',
    '  SEED_PHRASE_FILE                  0600 file containing the signing wallet seed phrase (preferred; Mainnet default requirement)',
    '  SEED_PHRASE                       24-word seed phrase for the signing wallet (testnet/default fallback)',
    '  BLOCKFROST_KEY                    Blockfrost project ID for the chosen network (required)',
    '  CARDANO402_CATALOG_URL            Alternative to --catalog',
    '  CARDANO402_NETWORK                Alternative to --network',
    '  CARDANO402_ALLOW_INSECURE=true    Allow non-HTTPS catalog URLs + private-CIDR base URLs',
    '  MAINNET=true                      Required to opt into a Mainnet connection',
    '  CARDANO402_LISTEN_HOST            Alternative to --listen-host',
    '  MCP_HTTP_BEARER_TOKEN             Alternative to --http-bearer-token',
    '  MCP_HTTP_ORIGIN_ALLOWLIST         Alternative to --http-origin-allowlist',
    '  CARDANO402_MAX_AMOUNT_PER_CALL    Alternative to --max-amount-per-call',
    '  CARDANO402_MAX_AMOUNT_PER_DAY     Alternative to --max-amount-per-day',
    '  CARDANO402_PAY_TO_ALLOWLIST       Alternative to --pay-to-allowlist',
    '  CARDANO402_MAINNET_CONFIRMED_TOOLS  Alternative to --mainnet-confirmed-tools',
    '  CARDANO402_ELICITATION_THRESHOLD  Alternative to --elicitation-threshold',
    '  CARDANO402_SPEND_STORE_PATH       Alternative to --spend-store-path',
    '  CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV=true  Permit Mainnet seed from SEED_PHRASE env var (unsafe hot-wallet override)',
  ].join('\n');
}
