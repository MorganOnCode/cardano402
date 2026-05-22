// Map an x402 catalog to MCP tools.
//
// One tool per catalog endpoint, named with the same recipe the producer
// uses for `/.well-known/mcp/server-card.json` (see `src/catalog.ts` in the
// root repo). On invocation, the tool calls `payAndFetch`, surfaces the
// resource body as a text content block, and reports the payment txHash
// via `structuredContent`.


import { Cardano402Error } from '@cardano402/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { CatalogEndpoint, WellKnownX402 } from './catalog.js';
import { resolveBaseUrl, toolNameFor } from './catalog.js';
import { payAndFetch } from './payment.js';
import type { CardanoSigner } from './signer.js';

const ToolInputShape = {
  body: z
    .unknown()
    .optional()
    .describe(
      'JSON body for POST/PUT/PATCH requests. Ignored for GET. Must match the endpoint inputSchema (if declared in the catalog).'
    ),
  query: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional query-string parameters appended to the endpoint URL.'),
};

export interface RegisterToolsOptions {
  catalog: WellKnownX402;
  catalogUrl: string;
  signer: CardanoSigner;
  /** Forwarded to `payAndFetch` for the resource-server HTTP call. */
  requestTimeoutMs?: number;
}

function describeEndpoint(endpoint: CatalogEndpoint): string {
  const base = endpoint.description ?? `${endpoint.method} ${endpoint.path}`;
  const price = `Price: ${endpoint.amount} ${endpoint.asset} on ${endpoint.network} -> ${endpoint.payTo}`;
  const schemaHint = endpoint.inputSchema
    ? `\n\nRequest body must match the JSON Schema:\n${JSON.stringify(endpoint.inputSchema, null, 2)}`
    : '';
  return `${base}\n\n${price}${schemaHint}`;
}

/**
 * Register one MCP tool per catalog endpoint on the supplied server.
 *
 * Returns the list of registered tool names so callers can log or assert
 * on them.
 */
export function registerTools(
  server: McpServer,
  options: RegisterToolsOptions
): string[] {
  const baseUrl = resolveBaseUrl(options.catalog, options.catalogUrl);
  const registered: string[] = [];
  const seen = new Set<string>();

  for (const endpoint of options.catalog.endpoints) {
    let name = toolNameFor(endpoint);
    if (seen.has(name)) {
      // Deterministic disambiguation: append `_2`, `_3`, ... — extremely
      // rare (would require two endpoints whose method+path collapse to
      // the same identifier) but cheap to guard against.
      let n = 2;
      while (seen.has(`${name}_${n}`)) n += 1;
      name = `${name}_${n}`;
    }
    seen.add(name);
    registered.push(name);

    server.registerTool(
      name,
      {
        description: describeEndpoint(endpoint),
        inputSchema: ToolInputShape,
        _meta: {
          'cardano402/endpoint': {
            method: endpoint.method,
            path: endpoint.path,
            network: endpoint.network,
            asset: endpoint.asset,
            amount: endpoint.amount,
            payTo: endpoint.payTo,
          },
        },
      },
      async (args) => {
        const { body, query } = args as { body?: unknown; query?: Record<string, string> };
        try {
          const result = await payAndFetch({
            baseUrl,
            endpoint,
            body,
            query,
            signer: options.signer,
            timeoutMs: options.requestTimeoutMs,
          });

          const payloadForAgent = {
            status: result.status,
            contentType: result.contentType,
            payment: result.payment,
            body: result.body,
          };

          const isError = result.status < 200 || result.status >= 300;
          return {
            isError,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(payloadForAgent, null, 2),
              },
            ],
          };
        } catch (err) {
          const message =
            err instanceof Cardano402Error
              ? `${err.name}: ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: message,
              },
            ],
          };
        }
      }
    );
  }

  return registered;
}
