// Orchestrate the MCP server: load catalog -> build signer -> register tools
// -> connect to the chosen transport.

import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { fetchCatalog } from './catalog.js';
import type { McpServerConfig } from './config.js';
import { createLucidSeedSigner, type CardanoSigner } from './signer.js';
import { registerTools } from './tools.js';

const SERVER_VERSION = '0.1.0-alpha.0';

export interface StartResult {
  /** Names of every tool registered against the MCP server. */
  toolNames: string[];
  /** Bech32 address that will be signing payments. */
  signerAddress: string;
  /** Resolved HTTP listen port (only meaningful when transport is `http`). */
  httpPort?: number;
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
}

const defaultLog = (msg: string, extra?: Record<string, unknown>): void => {
  // Never write to stdout — the stdio transport owns that channel.
  process.stderr.write(
    `[cardano402-mcp] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`
  );
};

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

  const toolNames = registerTools(server, {
    catalog,
    catalogUrl: options.catalogUrl,
    signer,
    requestTimeoutMs: options.requestTimeoutMs,
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
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer: HttpServer = createHttpServer((req, res) => {
    void (async () => {
      try {
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
    httpServer.listen(options.httpPort, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  log('listening', { transport: 'http', port: options.httpPort });

  return {
    toolNames,
    signerAddress,
    httpPort: options.httpPort,
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
