// Config + CLI parsing for @cardano402/mcp-server.
//
// Sources, in precedence: CLI flags > environment variables > defaults.
// All fields are validated through a Zod schema before reaching the runtime,
// so callers can rely on the parsed config being well-formed.

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

export const McpServerConfigSchema = z.object({
  catalogUrl: z.string().url(),
  transport: TransportSchema.default('stdio'),
  httpPort: z.number().int().min(1).max(65535).default(3333),
  network: LucidNetworkSchema.default('Preview'),
  blockfrostKey: z.string().min(1),
  signer: SignerConfigSchema,
  requestTimeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  allowInsecure: z.boolean().default(false),
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
  network?: string;
  help?: boolean;
}

/**
 * Minimal argv parser. Only walks the flags we accept and ignores positionals
 * so we never accidentally pull in a CLI parser dependency.
 */
export function parseArgs(argv: readonly string[]): RawArgs {
  const out: RawArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const consume = (key: keyof RawArgs): void => {
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      (out as Record<string, string>)[key as string] = next;
      i += 1;
    };
    switch (arg) {
      case '--catalog':
        consume('catalog');
        break;
      case '--transport':
        consume('transport');
        break;
      case '--port':
        consume('port');
        break;
      case '--network':
        consume('network');
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (arg.startsWith('--catalog=')) out.catalog = arg.slice('--catalog='.length);
        else if (arg.startsWith('--transport=')) out.transport = arg.slice('--transport='.length);
        else if (arg.startsWith('--port=')) out.port = arg.slice('--port='.length);
        else if (arg.startsWith('--network=')) out.network = arg.slice('--network='.length);
        break;
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

/**
 * Resolve a fully-validated config from CLI args + environment.
 *
 * Throws on the following hard errors:
 *  - missing `--catalog` / `CARDANO402_CATALOG_URL`
 *  - missing `BLOCKFROST_KEY` or `SEED_PHRASE`
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

  const seedPhrase = env.SEED_PHRASE;
  if (!seedPhrase) {
    throw new Error('SEED_PHRASE environment variable is required');
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

  return McpServerConfigSchema.parse({
    catalogUrl,
    transport: args.transport,
    httpPort,
    network,
    blockfrostKey,
    signer: { type: 'seed', seedPhrase },
    allowInsecure,
  });
}

export function helpText(): string {
  return [
    'Usage: cardano402-mcp [options]',
    '',
    'Options:',
    '  --catalog <url>       URL of /.well-known/x402.json (or set CARDANO402_CATALOG_URL)',
    '  --transport <name>    "stdio" (default) or "http"',
    '  --port <n>            HTTP transport port (default 3333)',
    '  --network <name>      Preview | Preprod | Mainnet (default Preview)',
    '  -h, --help            Show this help',
    '',
    'Environment:',
    '  SEED_PHRASE              24-word seed phrase for the signing wallet (required)',
    '  BLOCKFROST_KEY           Blockfrost project ID for the chosen network (required)',
    '  CARDANO402_CATALOG_URL   Alternative to --catalog',
    '  CARDANO402_NETWORK       Alternative to --network',
    '  CARDANO402_ALLOW_INSECURE=true  Allow non-HTTPS catalog URLs',
    '  MAINNET=true             Required to opt into a Mainnet connection',
  ].join('\n');
}
