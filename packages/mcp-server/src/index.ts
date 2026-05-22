// @cardano402/mcp-server — MCP server that exposes paid HTTP endpoints as
// MCP tools, paying via the x402 Cardano scheme.
//
// Usage (stdio, the common Claude Desktop / Cursor config):
//
//   await startCardano402Mcp({
//     catalogUrl: 'https://api.example.com/.well-known/x402.json',
//     transport: 'stdio',
//     network: 'Preview',
//     blockfrostKey: process.env.BLOCKFROST_KEY!,
//     signer: { type: 'seed', seedPhrase: process.env.SEED_PHRASE! },
//     httpPort: 3333,
//     requestTimeoutMs: 60_000,
//     allowInsecure: false,
//   });
//
// Or via the CLI: `cardano402-mcp --catalog <url> [--transport stdio|http] [--port N]`.

export { startCardano402Mcp } from './server.js';
export type {
  StartCardano402McpOptions,
  StartResult,
} from './server.js';

export {
  loadConfig,
  parseArgs,
  helpText,
  lucidNetworkFromCaip2,
  McpServerConfigSchema,
  SignerConfigSchema,
  TransportSchema,
  LucidNetworkSchema,
} from './config.js';
export type {
  McpServerConfig,
  SignerConfig,
  Transport,
  LucidNetwork,
  RawArgs,
  LoadConfigInput,
} from './config.js';

export {
  fetchCatalog,
  toolNameFor,
  resolveBaseUrl,
  CatalogEndpointSchema,
  CatalogServerInfoSchema,
  WellKnownX402Schema,
} from './catalog.js';
export type {
  CatalogEndpoint,
  CatalogServerInfo,
  WellKnownX402,
  FetchCatalogOptions,
} from './catalog.js';

export { createLucidSeedSigner } from './signer.js';
export type {
  CardanoSigner,
  SignPaymentArgs,
  SignedPayment,
  LucidSeedSignerOptions,
} from './signer.js';

export { payAndFetch } from './payment.js';
export type { PayAndFetchOptions, PayAndFetchResult } from './payment.js';

export { registerTools } from './tools.js';
export type { RegisterToolsOptions } from './tools.js';
