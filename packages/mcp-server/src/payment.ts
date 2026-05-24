// The x402 payment cycle: HTTP -> 402 -> sign -> retry.
//
// Lives behind a single function so the MCP tool layer can stay thin.
// Reuses the wire-format schemas + header codec from `@cardano402/core`
// rather than reimplementing base64+JSON+zod plumbing here.

import {
  Cardano402HttpError,
  Cardano402NetworkError,
  Cardano402ValidationError,
  PaymentRequiredResponseSchema,
  PaymentSignaturePayloadSchema,
  type PaymentAccept,
  type PaymentRequiredResponse,
} from '@cardano402/core';

import type { CatalogEndpoint } from './catalog.js';
import type { CardanoSigner } from './signer.js';
import type { SpendTracker } from './spend-tracker.js';

/**
 * Hook called before signing when the requested amount exceeds the
 * configured elicitation threshold. Implementations should surface an
 * MCP `elicitation/create` request to the client and return whether the
 * user accepted. Throwing or returning `false` aborts the signing.
 */
export type ElicitConfirmation = (args: {
  toolName: string;
  amount: bigint;
  asset: string;
  payTo: string;
  network: string;
}) => Promise<boolean>;

export interface PayAndFetchOptions {
  baseUrl: string;
  endpoint: CatalogEndpoint;
  /** Optional JSON body for non-GET requests. */
  body?: unknown;
  /** Optional extra query string (e.g. `?foo=bar`). */
  query?: Record<string, string>;
  signer: CardanoSigner;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Tracker enforcing per-call/per-day caps. Omit to skip enforcement. */
  spendTracker?: SpendTracker;
  /**
   * Lovelace threshold above which `elicit` must accept before signing.
   * Ignored if `elicit` is undefined.
   */
  elicitationThreshold?: bigint;
  /** Confirmation callback — typically wired to `mcpServer.server.elicitInput`. */
  elicit?: ElicitConfirmation;
  /** Tool name carried into the elicitation prompt; cosmetic only. */
  toolName?: string;
}

export interface PayAndFetchResult {
  status: number;
  /** Parsed JSON if the response declared `application/json`, otherwise raw text. */
  body: unknown;
  /** Decoded X-Payment-Response, if the server returned one. */
  payment: {
    transaction: string;
    network: string;
    payer?: string;
    status?: string;
  } | null;
  contentType: string | null;
}

const X402_HEADER_PRIMARY = 'Payment-Signature';
const X402_RESPONSE_HEADER_PRIMARY = 'x-payment-response';
const X402_RESPONSE_HEADER_ALIAS = 'payment-response';
const X402_REQUIRED_HEADER = 'payment-required';

function joinUrl(base: string, path: string, query?: Record<string, string>): string {
  const normalisedBase = base.replace(/\/+$/, '');
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const qs =
    query && Object.keys(query).length > 0
      ? `?${new URLSearchParams(query).toString()}`
      : '';
  return `${normalisedBase}${normalisedPath}${qs}`;
}

function decodePaymentRequired(headerValue: string): PaymentRequiredResponse {
  let json: string;
  try {
    json = Buffer.from(headerValue, 'base64').toString('utf-8');
  } catch (err) {
    throw new Cardano402NetworkError(
      `Payment-Required header was not valid base64: ${(err as Error).message}`,
      { cause: err }
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Cardano402NetworkError(
      `Payment-Required header was not valid JSON: ${(err as Error).message}`,
      { cause: err }
    );
  }
  const result = PaymentRequiredResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Cardano402ValidationError(
      'Payment-Required header did not match the expected schema',
      result.error.issues
    );
  }
  return result.data;
}

function decodePaymentResponseHeader(value: string): PayAndFetchResult['payment'] {
  try {
    const json = Buffer.from(value, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      transaction: String(parsed.transaction ?? ''),
      network: String(parsed.network ?? ''),
      payer: typeof parsed.payer === 'string' ? parsed.payer : undefined,
      status:
        parsed.extensions && typeof parsed.extensions === 'object'
          ? String(
              (parsed.extensions as Record<string, unknown>).status ?? ''
            ) || undefined
          : undefined,
    };
  } catch {
    return null;
  }
}

async function readBody(response: Response): Promise<{ body: unknown; contentType: string | null }> {
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.toLowerCase().includes('json')) {
    try {
      return { body: await response.json(), contentType };
    } catch {
      return { body: await response.text(), contentType };
    }
  }
  return { body: await response.text(), contentType };
}

function ensureCatalogMatchesAccept(
  endpoint: CatalogEndpoint,
  accept: PaymentAccept
): void {
  // The catalog is the contract we showed the agent. If the live 402
  // disagrees, refuse to pay rather than silently underwriting whatever
  // the resource server suddenly demands.
  if (accept.payTo !== endpoint.payTo) {
    throw new Cardano402ValidationError(
      `402 payTo (${accept.payTo}) does not match catalog payTo (${endpoint.payTo})`,
      []
    );
  }
  if (accept.amount !== endpoint.amount) {
    throw new Cardano402ValidationError(
      `402 amount (${accept.amount}) does not match catalog amount (${endpoint.amount})`,
      []
    );
  }
  if (accept.network !== endpoint.network) {
    throw new Cardano402ValidationError(
      `402 network (${accept.network}) does not match catalog network (${endpoint.network})`,
      []
    );
  }
}

/**
 * Run the full x402 cycle for one catalog endpoint.
 *
 * - GET / no-body: request is sent directly.
 * - Body provided: serialised as JSON with `Content-Type: application/json`.
 * - If the first call returns 402, decode the header, build a payment via
 *   the signer, and retry once with `Payment-Signature`.
 * - Any non-2xx response after the retry is returned to the caller as a
 *   `PayAndFetchResult` (status + body) so the MCP layer can surface it
 *   as a structured tool error rather than a thrown exception.
 */
export async function payAndFetch(options: PayAndFetchOptions): Promise<PayAndFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const url = joinUrl(options.baseUrl, options.endpoint.path, options.query);

  const buildInit = (extraHeaders: Record<string, string> = {}): RequestInit => {
    const init: RequestInit = {
      method: options.endpoint.method,
      headers: { Accept: 'application/json', ...extraHeaders },
    };
    if (options.body !== undefined && options.endpoint.method !== 'GET') {
      init.headers = {
        ...(init.headers as Record<string, string>),
        'Content-Type': 'application/json',
      };
      init.body = JSON.stringify(options.body);
    }
    return init;
  };

  const sendOnce = async (
    init: RequestInit,
    label: string
  ): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Cardano402NetworkError(
            `${label} request to ${url} timed out after ${timeoutMs}ms`,
            { cause: err }
          );
        }
        throw new Cardano402NetworkError(
          `${label} request to ${url} failed: ${(err as Error).message}`,
          { cause: err }
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  // ----- First attempt -----
  const first = await sendOnce(buildInit(), 'initial');
  if (first.status !== 402) {
    const { body, contentType } = await readBody(first);
    return { status: first.status, body, payment: null, contentType };
  }

  // ----- 402: parse, sign, retry -----
  const headerValue = first.headers.get(X402_REQUIRED_HEADER);
  if (!headerValue) {
    // Drain body so the connection can be reused.
    await first.text().catch(() => undefined);
    throw new Cardano402HttpError(
      402,
      first.statusText,
      'Server returned 402 without a Payment-Required header'
    );
  }
  // Drain the body — most 402s have an empty body but some send a hint.
  await first.text().catch(() => undefined);

  const required = decodePaymentRequired(headerValue);
  if (required.accepts.length === 0) {
    throw new Cardano402ValidationError(
      'Payment-Required header has an empty `accepts` array',
      []
    );
  }
  // Prefer an accept option whose network matches the catalog endpoint;
  // fall back to the first accept so single-network servers still work
  // when their network field happens to be slightly different from the
  // catalog's. ensureCatalogMatchesAccept does the final strict check.
  const accept =
    required.accepts.find((a) => a.network === options.endpoint.network) ??
    required.accepts[0];
  ensureCatalogMatchesAccept(options.endpoint, accept);

  // Pre-sign gates — these run BEFORE signer.signPayment so a failure here
  // never burns wallet UTXOs or daily budget.
  const amount = BigInt(accept.amount);
  if (options.spendTracker) {
    options.spendTracker.assertCanSpend({ amount, payTo: accept.payTo });
  }
  if (options.elicit && options.elicitationThreshold !== undefined && amount > options.elicitationThreshold) {
    const accepted = await options.elicit({
      toolName: options.toolName ?? 'unknown',
      amount,
      asset: accept.asset,
      payTo: accept.payTo,
      network: accept.network,
    });
    if (!accepted) {
      throw new Cardano402ValidationError(
        `signing declined by user via elicitation for amount ${amount.toString()} ${accept.asset} -> ${accept.payTo}`,
        []
      );
    }
  }

  const signed = await options.signer.signPayment({
    payTo: accept.payTo,
    amount,
    asset: accept.asset,
    ttlSeconds: accept.maxTimeoutSeconds,
  });
  // Only record AFTER a successful sign — failed signs don't burn budget.
  if (options.spendTracker) {
    options.spendTracker.record({ amount, payTo: accept.payTo });
  }

  const paymentPayload = PaymentSignaturePayloadSchema.parse({
    x402Version: 2 as const,
    accepted: accept,
    payload: {
      transaction: signed.cborBase64,
      nonce: signed.nonce,
      payer: await options.signer.address(),
    },
    resource: required.resource,
  });

  // PaymentSignaturePayloadSchema has already validated structure (including
  // the nonce regex). Encode as base64 JSON to match the gate's expected
  // `Payment-Signature` shape — same recipe as `examples/client.ts`.
  // Only emit one header (canonical mixed-case) — gates that need the
  // upper-case alias still see it via HTTP's case-insensitive matching.
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  const retryInit = buildInit({
    [X402_HEADER_PRIMARY]: paymentHeader,
  });
  const retry = await sendOnce(retryInit, 'paid');

  const { body, contentType } = await readBody(retry);
  const responseHeader =
    retry.headers.get(X402_RESPONSE_HEADER_PRIMARY) ??
    retry.headers.get(X402_RESPONSE_HEADER_ALIAS);
  const payment = responseHeader ? decodePaymentResponseHeader(responseHeader) : null;

  return { status: retry.status, body, payment, contentType };
}
