// Fetch + parse a remote /.well-known/x402.json manifest.
//
// The shape mirrors `src/catalog.ts` in the root repo (the producer), kept
// loose where the producer is loose so this MCP server can talk to any
// x402-compliant resource server, not just cardano402's.

import {
  Cardano402HttpError,
  Cardano402NetworkError,
  Cardano402ValidationError,
} from '@cardano402/core';
import { z } from 'zod';


export const CatalogEndpointSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    path: z.string().min(1),
    scheme: z.string().default('exact'),
    network: z.string().min(1),
    amount: z.string().min(1),
    asset: z.string().min(1),
    payTo: z.string().min(1),
    maxTimeoutSeconds: z.number().int().positive(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type CatalogEndpoint = z.infer<typeof CatalogEndpointSchema>;

export const CatalogServerInfoSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    contact: z.string().optional(),
    url: z.string().url().optional(),
  })
  .passthrough();
export type CatalogServerInfo = z.infer<typeof CatalogServerInfoSchema>;

export const WellKnownX402Schema = z
  .object({
    x402Version: z.literal(2),
    server: CatalogServerInfoSchema.optional(),
    endpoints: z.array(CatalogEndpointSchema),
    facilitator: z.string().url().optional(),
  })
  .passthrough();
export type WellKnownX402 = z.infer<typeof WellKnownX402Schema>;

export interface FetchCatalogOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch and validate a remote /.well-known/x402.json catalog.
 *
 * Throws `Cardano402NetworkError` for transport / abort failures,
 * `Cardano402HttpError` for non-2xx responses,
 * `Cardano402ValidationError` for JSON that doesn't match the schema.
 */
export async function fetchCatalog(
  url: string,
  options: FetchCatalogOptions = {}
): Promise<WellKnownX402> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Cardano402NetworkError(
          `Catalog fetch from ${url} timed out after ${timeoutMs}ms`,
          { cause: err }
        );
      }
      throw new Cardano402NetworkError(
        `Catalog fetch from ${url} failed: ${(err as Error).message}`,
        { cause: err }
      );
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        try {
          body = await response.text();
        } catch {
          body = undefined;
        }
      }
      throw new Cardano402HttpError(response.status, response.statusText, body);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new Cardano402NetworkError(
        `Catalog response from ${url} was not valid JSON: ${(err as Error).message}`,
        { cause: err }
      );
    }

    const parsed = WellKnownX402Schema.safeParse(json);
    if (!parsed.success) {
      throw new Cardano402ValidationError(
        `Catalog response from ${url} did not match expected schema`,
        parsed.error.issues
      );
    }
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Derive a stable MCP tool name from an endpoint. Mirrors the recipe in
 * the producer at `src/catalog.ts:toMcpServerCardJson` so a client that
 * has crawled `/.well-known/mcp/server-card.json` sees the same names.
 */
export function toolNameFor(endpoint: Pick<CatalogEndpoint, 'method' | 'path'>): string {
  return `${endpoint.method.toLowerCase()}_${endpoint.path
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;
}

/**
 * Resolve the base origin from which the endpoints are served.
 *
 * Order of preference:
 *   1. `catalog.server.url` (the catalog publisher's self-declared base)
 *   2. The origin of the `catalogUrl` itself (e.g. strip
 *      `/.well-known/x402.json`)
 */
export function resolveBaseUrl(catalog: WellKnownX402, catalogUrl: string): string {
  if (catalog.server?.url) {
    return catalog.server.url.replace(/\/+$/, '');
  }
  const parsed = new URL(catalogUrl);
  return `${parsed.protocol}//${parsed.host}`;
}
