// Fetch + parse a remote /.well-known/x402.json manifest.
//
// The shape mirrors `src/catalog.ts` in the root repo (the producer), kept
// loose where the producer is loose so this MCP server can talk to any
// x402-compliant resource server, not just cardano402's.

import {
  CardanoAddressSchema,
  Cardano402HttpError,
  Cardano402NetworkError,
  Cardano402ValidationError,
  LovelaceAmountSchema,
  NetworkSchema,
} from '@cardano402/core';
import { z } from 'zod';

export const MAX_CATALOG_PAYMENT_TIMEOUT_SECONDS = 3600;

const AssetIdentifierSchema = z.union([
  z.literal('lovelace'),
  z
    .string()
    .regex(/^[0-9a-f]{56}\.[0-9a-f]{2,64}$/)
    .refine((value) => {
      const assetNameHex = value.split('.')[1];
      return typeof assetNameHex === 'string' && assetNameHex.length % 2 === 0;
    }),
]);

export const CatalogEndpointSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    path: z.string().min(1),
    scheme: z.string().default('exact'),
    network: NetworkSchema,
    amount: LovelaceAmountSchema,
    asset: AssetIdentifierSchema,
    payTo: CardanoAddressSchema,
    maxTimeoutSeconds: z.number().int().min(1).max(MAX_CATALOG_PAYMENT_TIMEOUT_SECONDS),
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
  /** When false (default), private/loopback/link-local catalogs are rejected. */
  allowInsecure?: boolean;
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
  if (!options.allowInsecure) {
    assertPublicUrl(url, 'catalogUrl');
  }
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

/**
 * Reject obviously-traversal-y endpoint paths. Run at registerTools time so
 * a malicious catalog can't get a tool registered that smuggles `..` or NULs
 * past the URL joiner.
 */
export function assertSafePath(path: string): void {
  if (path.length === 0) {
    throw new Cardano402ValidationError('endpoint.path must not be empty', []);
  }
  if (path.includes('\0')) {
    throw new Cardano402ValidationError('endpoint.path contains NUL byte', []);
  }
  // Reject embedded whitespace and CR/LF that would let a catalog smuggle a
  // header into the eventual HTTP request line.
  if (/[\s\r\n]/.test(path)) {
    throw new Cardano402ValidationError(
      `endpoint.path '${path}' contains whitespace or CR/LF`,
      []
    );
  }
  if (/(^|\/)\.\.(\/|$)/.test(path)) {
    throw new Cardano402ValidationError(
      `endpoint.path '${path}' contains a parent-directory segment`,
      []
    );
  }
  // Reject absolute URLs in the path slot — the base origin is fixed by
  // resolveBaseUrl, so a path that's already an absolute URL is trying to
  // re-target the request elsewhere.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Cardano402ValidationError(
      `endpoint.path '${path}' looks like an absolute URL; expected a relative path`,
      []
    );
  }
  // Also reject `//host/...` protocol-relative forms.
  if (path.startsWith('//')) {
    throw new Cardano402ValidationError(
      `endpoint.path '${path}' looks protocol-relative; expected a single '/'-prefixed path`,
      []
    );
  }
}

/**
 * Reject URLs that resolve to private, loopback, or link-local hosts. Used
 * to guard against SSRF via attacker-controlled `catalog.server.url` (H11).
 *
 * `allowInsecure` short-circuits this check — operators running against a
 * dev catalog on localhost need to pass that flag explicitly.
 */
export function assertPublicUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Cardano402ValidationError(`${label} is not a valid URL: ${url}`, []);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Cardano402ValidationError(
      `${label} '${url}' uses unsupported protocol '${parsed.protocol}'`,
      []
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (isLoopbackHostname(host) || isPrivateOrReservedHostname(host)) {
    throw new Cardano402ValidationError(
      `${label} '${url}' resolves to a private, loopback, or reserved address; ` +
        `set CARDANO402_ALLOW_INSECURE=true to override`,
      []
    );
  }
}

function isLoopbackHostname(host: string): boolean {
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '[::1]') return true;
  if (host === '0.0.0.0' || host === '[::]') return true;
  // IPv4 loopback range 127.0.0.0/8
  const v4 = parseIpv4(host);
  if (v4 && v4[0] === 127) return true;
  return false;
}

function isPrivateOrReservedHostname(host: string): boolean {
  const v4 = parseIpv4(host);
  if (v4) {
    const [a, b] = v4;
    // RFC1918
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // Link-local 169.254/16
    if (a === 169 && b === 254) return true;
    // CGNAT 100.64/10
    if (a === 100 && b >= 64 && b <= 127) return true;
    // Multicast 224.0/4
    if (a >= 224 && a <= 239) return true;
    // 0.0.0.0/8 reserved
    if (a === 0) return true;
    return false;
  }
  // IPv6 — strip brackets if present
  const v6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (v6.includes(':')) {
    const lower = v6.toLowerCase();
    // IPv4-mapped ::ffff:a.b.c.d. URL.hostname may return this with or
    // without brackets depending on the runtime; handle it before the
    // broad IPv6 prefix checks.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isLoopbackHostname(mapped[1]) || isPrivateOrReservedHostname(mapped[1]);
    }
    const mappedHex = parseIpv4MappedIpv6(lower);
    if (mappedHex) {
      return isPrivateOrReservedIpv4(mappedHex);
    }
    // RFC4193 unique local fc00::/7 — first byte 0xfc or 0xfd
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  }
  return false;
}

function isPrivateOrReservedIpv4(v4: [number, number, number, number]): boolean {
  const [a, b] = v4;
  // RFC1918
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Loopback 127/8
  if (a === 127) return true;
  // Link-local 169.254/16
  if (a === 169 && b === 254) return true;
  // CGNAT 100.64/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Multicast 224.0/4
  if (a >= 224 && a <= 239) return true;
  // 0.0.0.0/8 reserved
  if (a === 0) return true;
  return false;
}

function parseIpv4MappedIpv6(host: string): [number, number, number, number] | null {
  const m = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!m) return null;
  const hi = Number.parseInt(m[1], 16);
  const lo = Number.parseInt(m[2], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo) || hi > 0xffff || lo > 0xffff) {
    return null;
  }
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  for (const p of parts) {
    if (Number.isNaN(p) || p < 0 || p > 255) return null;
  }
  return parts as [number, number, number, number];
}
