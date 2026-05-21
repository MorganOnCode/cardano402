import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FacilitatorClient } from '../src/client.js';
import {
  Cardano402HttpError,
  Cardano402NetworkError,
  Cardano402ValidationError,
} from '../src/errors.js';
import { decodePaymentHeader } from '../src/header.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  StatusResponse,
  SupportedResponse,
  VerifyResponse,
} from '../src/schemas.js';

const sampleRequirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'cardano:preview',
  asset: 'lovelace',
  amount: '2000000',
  payTo: 'addr_test1abc',
  maxTimeoutSeconds: 300,
};

const samplePayload: PaymentPayload = {
  x402Version: 2,
  accepted: sampleRequirements,
  payload: { transaction: 'tx-bytes' },
};

const verifyResponse: VerifyResponse = { isValid: true };
const settleResponse: SettleResponse = {
  success: false,
  transaction: '',
  network: 'cardano:preview',
  errorReason: 'submission_failed',
  extensions: { status: 'failed' },
};
const statusResponse: StatusResponse = { status: 'confirmed', transaction: 'tx' };
const supportedResponse: SupportedResponse = {
  kinds: [{ x402Version: 2, scheme: 'exact', network: 'cardano:preview' }],
  extensions: [],
  signers: { 'cardano:preview': ['addr_test1xxx'] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FacilitatorClient constructor', () => {
  it('strips trailing slashes from baseUrl', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://example.com//' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(supportedResponse));
    await client.supported();
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/supported');
    fetchSpy.mockRestore();
  });
});

describe('FacilitatorClient.supported', () => {
  it('GETs /supported and returns the parsed response', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(supportedResponse));
    const result = await client.supported();
    expect(result).toEqual(supportedResponse);
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('GET');
    fetchSpy.mockRestore();
  });
});

describe('FacilitatorClient.verify', () => {
  it('POSTs native shape with paymentPayload object', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(verifyResponse));
    const result = await client.verify({
      x402Version: 2,
      paymentPayload: samplePayload,
      paymentRequirements: sampleRequirements,
    });
    expect(result).toEqual(verifyResponse);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.paymentPayload).toBeDefined();
    expect(body.paymentHeader).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('POSTs raw-header shape when sendRawHeader is true', async () => {
    const client = new FacilitatorClient({
      baseUrl: 'https://f.example.com',
      sendRawHeader: true,
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(verifyResponse));
    await client.verify({
      x402Version: 2,
      paymentPayload: samplePayload,
      paymentRequirements: sampleRequirements,
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.paymentPayload).toBeUndefined();
    expect(typeof body.paymentHeader).toBe('string');
    const decoded = decodePaymentHeader(body.paymentHeader);
    expect(decoded.payload.transaction).toBe('tx-bytes');
    fetchSpy.mockRestore();
  });
});

describe('FacilitatorClient.settle', () => {
  it('POSTs /settle and parses extensions.status: failed', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(settleResponse));
    const result = await client.settle({
      x402Version: 2,
      paymentPayload: samplePayload,
      paymentRequirements: sampleRequirements,
    });
    expect(result.extensions?.status).toBe('failed');
    fetchSpy.mockRestore();
  });
});

describe('FacilitatorClient.status', () => {
  it('POSTs /status with { transaction, paymentRequirements }', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(statusResponse));
    const txHash = 'a'.repeat(64);
    const result = await client.status({
      transaction: txHash,
      paymentRequirements: sampleRequirements,
    });
    expect(result).toEqual(statusResponse);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.transaction).toBe(txHash);
    expect(body.paymentRequirements).toBeDefined();
    fetchSpy.mockRestore();
  });
});

describe('FacilitatorClient error mapping', () => {
  it('maps non-2xx to Cardano402HttpError with status + body', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'boom' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    let caught: unknown;
    try {
      await client.supported();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402HttpError);
    expect((caught as Cardano402HttpError).status).toBe(500);
    expect((caught as Cardano402HttpError).body).toEqual({ message: 'boom' });
    fetchSpy.mockRestore();
  });

  it('maps bad response shape to Cardano402ValidationError', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ nonsense: true }));
    let caught: unknown;
    try {
      await client.supported();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402ValidationError);
    expect((caught as Cardano402ValidationError).issues.length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });

  it('maps fetch rejection to Cardano402NetworkError with cause', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com' });
    const networkErr = new Error('socket hang up');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(networkErr);
    let caught: unknown;
    try {
      await client.supported();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402NetworkError);
    expect((caught as Error & { cause?: unknown }).cause).toBe(networkErr);
    fetchSpy.mockRestore();
  });

  it('maps AbortError to Cardano402NetworkError', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com', timeout: 10 });
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(abortErr);
    let caught: unknown;
    try {
      await client.supported();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402NetworkError);
    expect((caught as Error).message.toLowerCase()).toContain('timed out');
    fetchSpy.mockRestore();
  });

  it('aborts when response body is slow past timeout', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com', timeout: 50 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_url, init) => {
        const signal = (init as RequestInit | undefined)?.signal;
        // Hand-construct a Response whose .json() never resolves
        // unless/until the abort signal fires. Mirrors a hostile
        // facilitator that returns headers immediately but stalls the
        // body indefinitely.
        const stalledResponse = new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
        Object.defineProperty(stalledResponse, 'json', {
          value: () =>
            new Promise<unknown>((_resolve, reject) => {
              if (signal?.aborted) {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
                return;
              }
              signal?.addEventListener('abort', () => {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
              });
            }),
        });
        return stalledResponse;
      });

    let caught: unknown;
    try {
      await client.supported();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402NetworkError);
    expect((caught as Error).message.toLowerCase()).toContain('timed out');
    expect((caught as Error).message.toLowerCase()).toContain('response body');
    fetchSpy.mockRestore();
  });

  it('aborts when error body is slow past timeout', async () => {
    const client = new FacilitatorClient({ baseUrl: 'https://f.example.com', timeout: 50 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_url, init) => {
        const signal = (init as RequestInit | undefined)?.signal;
        const stalledResponse = new Response(null, {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        });
        const stallingReader = (): Promise<unknown> =>
          new Promise<unknown>((_resolve, reject) => {
            if (signal?.aborted) {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        Object.defineProperty(stalledResponse, 'json', { value: stallingReader });
        Object.defineProperty(stalledResponse, 'text', { value: stallingReader });
        return stalledResponse;
      });

    let caught: unknown;
    try {
      await client.supported();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402NetworkError);
    expect((caught as Error).message.toLowerCase()).toContain('timed out');
    expect((caught as Error).message.toLowerCase()).toContain('error body');
    fetchSpy.mockRestore();
  });

});

describe('FacilitatorClient HTTPS enforcement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns on http:// non-loopback baseUrl', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new FacilitatorClient({ baseUrl: 'http://example.com' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('not HTTPS');
    expect(msg).toContain('cleartext');
  });

  it('does not warn on https:// baseUrl', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new FacilitatorClient({ baseUrl: 'https://example.com' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn on http://localhost / 127.0.0.1 / [::1]', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new FacilitatorClient({ baseUrl: 'http://localhost:3000' });
    new FacilitatorClient({ baseUrl: 'http://127.0.0.1:3000' });
    new FacilitatorClient({ baseUrl: 'http://[::1]:3000' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('suppresses warning when allowInsecure: true', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new FacilitatorClient({ baseUrl: 'http://example.com', allowInsecure: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('FacilitatorClient custom headers', () => {
  beforeEach(() => {
    // ensure a clean spy per test
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('propagates custom headers on POST and GET', async () => {
    const client = new FacilitatorClient({
      baseUrl: 'https://f.example.com',
      headers: { Authorization: 'Bearer xyz' },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(supportedResponse))
      .mockResolvedValueOnce(jsonResponse(verifyResponse));
    await client.supported();
    await client.verify({
      x402Version: 2,
      paymentPayload: samplePayload,
      paymentRequirements: sampleRequirements,
    });
    const getInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const postInit = fetchSpy.mock.calls[1][1] as RequestInit;
    expect((getInit.headers as Record<string, string>).Authorization).toBe('Bearer xyz');
    expect((postInit.headers as Record<string, string>).Authorization).toBe('Bearer xyz');
    expect((postInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
