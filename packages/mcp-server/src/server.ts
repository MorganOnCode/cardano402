// Orchestrate the MCP server: load catalog -> build signer -> register tools
// -> connect to the chosen transport.

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { fetchCatalog } from './catalog.js';
import type { McpServerConfig } from './config.js';
import { VERSION as SERVER_VERSION } from './generated-version.js';
import type { ElicitConfirmation } from './payment.js';
import { createLucidSeedSigner, type CardanoSigner } from './signer.js';
import { SpendTracker } from './spend-tracker.js';
import { registerTools } from './tools.js';

export interface StartResult {
  /** Names of every tool registered against the MCP server. */
  toolNames: string[];
  /** Bech32 address that will be signing payments. */
  signerAddress: string;
  /** Resolved HTTP listen port (only meaningful when transport is `http`). */
  httpPort?: number;
  /** Resolved HTTP listen host (only meaningful when transport is `http`). */
  httpHost?: string;
  /** Tear down all open transports and HTTP listeners. */
  stop(): Promise<void>;
}

export interface StartCardano402McpOptions extends McpServerConfig {
  /** Inject a pre-built signer (mainly for tests); default builds a Lucid+Blockfrost one. */
  signerOverride?: CardanoSigner;
  /** Inject `fetch` for the catalog request (mainly for tests). */
  fetchImpl?: typeof fetch;
  /** Optional structured logger — defaults to stderr so stdio stdout isn't polluted. */
  log?: (message: string, extra?: Record<string, unknown>) => void;
  /** Override the elicitation callback (mainly for tests). */
  elicitOverride?: ElicitConfirmation;
}

const defaultLog = (msg: string, extra?: Record<string, unknown>): void => {
  // Never write to stdout — the stdio transport owns that channel.
  process.stderr.write(
    `[cardano402-mcp] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`
  );
};

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;
  if (/^127\./.test(host)) return true;
  return false;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

// Length-cap defends against pathological inputs; no real Authorization
// header will ever be this long.
const MAX_AUTH_HEADER_LENGTH = 8192;
const MIN_HTTP_BEARER_TOKEN_LENGTH = 32;

function readBearer(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length > MAX_AUTH_HEADER_LENGTH) return null;
  // Parse without a backtracking regex (CodeQL js/polynomial-redos): a
  // greedy `\s+(.+)$` on attacker-controlled input is a classic ReDoS shape.
  if (value.length < 7) return null;
  if (value.slice(0, 6).toLowerCase() !== 'bearer') return null;
  const sep = value.charCodeAt(6);
  // Require exactly one SP or HT after "Bearer"; reject obs-fold/control chars.
  if (sep !== 0x20 && sep !== 0x09) return null;
  const token = value.slice(7);
  if (/[\s]/u.test(token)) return null;
  return token.length > 0 ? token : null;
}

function bearerMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}

/**
 * Boot a configured `@cardano402/mcp-server` instance.
 *
 * Returns once the chosen transport is up and listening. Callers receive a
 * `stop()` handle to take it down again (used by the CLI's signal handlers
 * and by integration tests).
 */
export async function startCardano402Mcp(
  options: StartCardano402McpOptions
): Promise<StartResult> {
  const log = options.log ?? defaultLog;

  const catalog = await fetchCatalog(options.catalogUrl, {
    timeoutMs: options.requestTimeoutMs,
    fetchImpl: options.fetchImpl,
    allowInsecure: options.allowInsecure,
  });
  log('catalog fetched', {
    endpoints: catalog.endpoints.length,
    server: catalog.server?.name,
  });

  const signer =
    options.signerOverride ??
    (await createLucidSeedSigner({
      network: options.network,
      blockfrostKey: options.blockfrostKey,
      seedPhrase: options.signer.seedPhrase,
    }));
  const signerAddress = await signer.address();
  log('signer ready', { address: signerAddress, network: options.network });

  const server = new McpServer({
    name: catalog.server?.name ?? 'cardano402-mcp',
    version: SERVER_VERSION,
  });

  const spendTracker = new SpendTracker({
    maxAmountPerCall: options.maxAmountPerCall,
    maxAmountPerDay: options.maxAmountPerDay,
    payToAllowlist: options.payToAllowlist,
    storePath: options.spendStorePath,
  });
  log('spend tracker ready', { persistent: options.spendStorePath ? 'true' : 'false' });

  // Default elicitation threshold = per-call cap, so any signing that
  // saturates the per-call limit requires a user accept. Operators can lower
  // the threshold to require confirmation on smaller amounts.
  const elicitationThreshold =
    options.elicitationThresholdAmount ?? options.maxAmountPerCall;

  const elicit: ElicitConfirmation =
    options.elicitOverride ??
    (async (args) => {
      try {
        const result = await server.server.elicitInput({
          message:
            `cardano402-mcp is about to sign a payment of ${args.amount.toString()} ` +
            `${args.asset} on ${args.network} to ${args.payTo} for tool "${args.toolName}". ` +
            `Type 'yes' to approve.`,
          requestedSchema: {
            type: 'object',
            properties: {
              approve: {
                type: 'string',
                description: 'Type "yes" to approve the signing; anything else declines.',
              },
            },
            required: ['approve'],
          },
        });
        if (result.action !== 'accept') return false;
        const approve = (result.content as Record<string, unknown> | undefined)?.approve;
        return typeof approve === 'string' && approve.trim().toLowerCase() === 'yes';
      } catch (err) {
        log('elicitation failed; treating as decline', { error: (err as Error).message });
        return false;
      }
    });

  const mainnetConfirmedTools = new Set(options.mainnetConfirmedTools);

  const toolNames = registerTools(server, {
    catalog,
    catalogUrl: options.catalogUrl,
    signer,
    requestTimeoutMs: options.requestTimeoutMs,
    allowInsecure: options.allowInsecure,
    spendTracker,
    elicitationThreshold,
    elicit,
    mainnetConfirmedTools,
    log,
  });
  log('tools registered', { count: toolNames.length, tools: toolNames });

  if (options.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('listening', { transport: 'stdio' });

    return {
      toolNames,
      signerAddress,
      async stop() {
        await server.close();
      },
    };
  }

  // ---- HTTP (Streamable HTTP) ----
  if (
    options.httpBearerToken !== undefined &&
    options.httpBearerToken.length < MIN_HTTP_BEARER_TOKEN_LENGTH
  ) {
    throw new Error(
      `HTTP bearer token must be at least ${MIN_HTTP_BEARER_TOKEN_LENGTH} characters`
    );
  }
  if (!isLoopbackHost(options.listenHost) && !options.httpBearerToken) {
    log('refusing to start HTTP transport on a non-loopback host without a bearer token', {
      listenHost: options.listenHost,
    });
    throw new Error(
      `HTTP transport on '${options.listenHost}' requires --http-bearer-token / MCP_HTTP_BEARER_TOKEN; ` +
        `set one or use --listen-host 127.0.0.1`
    );
  }
  if (!isLoopbackHost(options.listenHost)) {
    log('WARNING: HTTP transport is listening on a non-loopback host', {
      listenHost: options.listenHost,
      mitigations: ['bearer-token-required', 'origin-allowlist-enforced'],
    });
  }

  const allowedOrigins = new Set(options.httpOriginAllowlist);

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer: HttpServer = createHttpServer((req, res) => {
    void (async () => {
      try {
        // ---- Origin check (loopback + allowlist) ----
        const originHeader = req.headers['origin'];
        const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
        if (origin !== undefined) {
          const ok = isLoopbackOrigin(origin) || allowedOrigins.has(origin);
          if (!ok) {
            res.statusCode = 403;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'forbidden_origin' }));
            return;
          }
        }

        // ---- Bearer token (if configured) ----
        if (options.httpBearerToken) {
          const presented = readBearer(req);
          if (!bearerMatches(presented, options.httpBearerToken)) {
            res.statusCode = 401;
            res.setHeader('content-type', 'application/json');
            res.setHeader('www-authenticate', 'Bearer realm="cardano402-mcp"');
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
        }

        // Stateless mode is simpler but disables resumability and SSE
        // event replay. Keep stateful mode by default; one transport per
        // session id, generated server-side.
        const sessionHeader = req.headers['mcp-session-id'];
        const existingSession = Array.isArray(sessionHeader)
          ? sessionHeader[0]
          : sessionHeader;
        const existing = existingSession ? transports.get(existingSession) : undefined;
        let transport: StreamableHTTPServerTransport;
        if (existing) {
          transport = existing;
        } else {
          const fresh = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, fresh);
            },
          });
          fresh.onclose = () => {
            if (fresh.sessionId) transports.delete(fresh.sessionId);
          };
          await server.connect(fresh);
          transport = fresh;
        }

        await transport.handleRequest(req, res);
      } catch (err) {
        log('http handler error', { error: (err as Error).message });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.httpPort, options.listenHost, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  const boundPort =
    typeof address === 'object' && address !== null ? address.port : options.httpPort;
  log('listening', {
    transport: 'http',
    host: options.listenHost,
    port: boundPort,
    bearer: options.httpBearerToken ? 'required' : 'not_set',
  });

  return {
    toolNames,
    signerAddress,
    httpPort: boundPort,
    httpHost: options.listenHost,
    async stop() {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      for (const t of transports.values()) {
        await t.close().catch(() => undefined);
      }
      transports.clear();
      await server.close();
    },
  };
}
