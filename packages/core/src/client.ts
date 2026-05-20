import type { z } from 'zod';

import {
  SettleResponseSchema,
  StatusResponseSchema,
  SupportedResponseSchema,
  VerifyResponseSchema,
  type SettleRequest,
  type SettleResponse,
  type StatusRequest,
  type StatusResponse,
  type SupportedResponse,
  type VerifyRequest,
  type VerifyResponse,
} from './schemas.js';
import { encodePaymentHeader } from './header.js';
import {
  Cardano402HttpError,
  Cardano402NetworkError,
  Cardano402ValidationError,
} from './errors.js';

export interface FacilitatorClientOptions {
  /** Base URL of the facilitator (e.g. "http://localhost:3000") */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Additional headers to send with every request */
  headers?: Record<string, string>;
  /**
   * When true, the client sends the base x402 form
   * `{ x402Version, paymentHeader: <base64-string>, paymentRequirements }`.
   *
   * When false (default), the client sends the cardano402-native form
   * `{ x402Version, paymentPayload: <object>, paymentRequirements }`.
   *
   * Both shapes are accepted by cardano402's facilitator endpoints.
   */
  sendRawHeader?: boolean;
}

export class FacilitatorClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;
  private readonly sendRawHeader: boolean;

  constructor(options: FacilitatorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.headers = options.headers ?? {};
    this.sendRawHeader = options.sendRawHeader ?? false;
  }

  async supported(): Promise<SupportedResponse> {
    return this.get('/supported', SupportedResponseSchema);
  }

  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    const body = this.sendRawHeader ? this.toRawHeaderRequest(request) : request;
    return this.post('/verify', body, VerifyResponseSchema);
  }

  async settle(request: SettleRequest): Promise<SettleResponse> {
    const body = this.sendRawHeader ? this.toRawHeaderRequest(request) : request;
    return this.post('/settle', body, SettleResponseSchema);
  }

  async status(request: StatusRequest): Promise<StatusResponse> {
    return this.post('/status', request, StatusResponseSchema);
  }

  private toRawHeaderRequest(req: VerifyRequest | SettleRequest): {
    x402Version: 2;
    paymentHeader: string;
    paymentRequirements: VerifyRequest['paymentRequirements'];
  } {
    return {
      x402Version: 2,
      paymentHeader: encodePaymentHeader(req.paymentPayload),
      paymentRequirements: req.paymentRequirements,
    };
  }

  private async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>
  ): Promise<T> {
    return this.request(path, schema, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(body),
    });
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema, {
      method: 'GET',
      headers: { ...this.headers },
    });
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Cardano402NetworkError(
          `Facilitator request to ${path} timed out after ${this.timeout}ms`,
          { cause: err }
        );
      }
      throw new Cardano402NetworkError(
        `Facilitator request to ${path} failed: ${(err as Error).message}`,
        { cause: err }
      );
    }
    clearTimeout(timeoutId);

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
        `Facilitator response from ${path} was not valid JSON: ${(err as Error).message}`,
        { cause: err }
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Cardano402ValidationError(
        `Facilitator response from ${path} did not match expected schema`,
        parsed.error.issues
      );
    }
    return parsed.data;
  }
}
