// FacilitatorClient -- HTTP wrapper for the x402 facilitator API.
//
// Resource servers use this to call /verify, /settle, /status, and /supported.
// Uses native fetch (Node 20+) with AbortController timeout and Zod validation.

import type { z } from 'zod';

import type { SupportedResponse } from './types.js';
import { SupportedResponseSchema } from './types.js';
import type {
  SettleRequest,
  SettleResponse,
  StatusRequest,
  StatusResponse,
} from '../settle/types.js';
import { SettleResponseSchema, StatusResponseSchema } from '../settle/types.js';
import type { VerifyRequest, VerifyResponse } from '../verify/types.js';
import { VerifyResponseSchema } from '../verify/types.js';

export interface FacilitatorClientOptions {
  /** Base URL of the facilitator (e.g. "http://localhost:3000") */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Additional headers to send with every request */
  headers?: Record<string, string>;
  /**
   * If true, the client sends the base x402 form
   * `{ x402Version, paymentHeader: <base64-string>, paymentRequirements }`.
   *
   * If false (default), the client sends the cardano402-native form
   * `{ x402Version, paymentPayload: <object>, paymentRequirements }`.
   *
   * Both shapes are accepted by cardano402's facilitator endpoints.
   */
  sendRawHeader?: boolean;
}

/**
 * Convert a cardano402-native VerifyRequest/SettleRequest into the
 * base x402 `{ paymentHeader: base64 }` form.
 */
function toRawHeaderRequest(req: VerifyRequest | SettleRequest): {
  x402Version: 2;
  paymentHeader: string;
  paymentRequirements: VerifyRequest['paymentRequirements'];
} {
  const json = JSON.stringify(req.paymentPayload);
  const paymentHeader = Buffer.from(json, 'utf-8').toString('base64');
  return {
    x402Version: 2,
    paymentHeader,
    paymentRequirements: req.paymentRequirements,
  };
}

export class FacilitatorClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;
  private readonly sendRawHeader: boolean;

  constructor(options: FacilitatorClientOptions) {
    // Strip trailing slash for consistent URL building
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.headers = options.headers ?? {};
    this.sendRawHeader = options.sendRawHeader ?? false;
  }

  /**
   * Verify a payment against the facilitator.
   * POST /verify
   */
  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    const body = this.sendRawHeader ? toRawHeaderRequest(request) : request;
    return this.post('/verify', body, VerifyResponseSchema);
  }

  /**
   * Settle a payment via the facilitator (submit tx on-chain).
   * POST /settle
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    const body = this.sendRawHeader ? toRawHeaderRequest(request) : request;
    return this.post('/settle', body, SettleResponseSchema);
  }

  /**
   * Check transaction confirmation status.
   * POST /status
   */
  async status(request: StatusRequest): Promise<StatusResponse> {
    return this.post('/status', request, StatusResponseSchema);
  }

  /**
   * Get the facilitator's supported chains, schemes, and signer addresses.
   * GET /supported
   */
  async supported(): Promise<SupportedResponse> {
    return this.get('/supported', SupportedResponseSchema);
  }

  // ---- Private helpers ----

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Facilitator returned ${response.status} ${response.statusText}`);
      }

      const json: unknown = await response.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Invalid facilitator response: ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Facilitator request to ${path} timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...this.headers },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Facilitator returned ${response.status} ${response.statusText}`);
      }

      const json: unknown = await response.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Invalid facilitator response: ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Facilitator request to ${path} timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
