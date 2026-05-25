import fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { FacilitatorClient } from '../../../src/sdk/facilitator-client.js';
import { createPaymentGate } from '../../../src/sdk/payment-gate.js';
import type { PaymentGateOptions } from '../../../src/sdk/payment-gate.js';

// Handler type without Fastify's `this` context binding (not needed in unit tests)
type HandlerFn = (request: FastifyRequest, reply: FastifyReply, done: () => void) => Promise<void>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFacilitator(overrides: Partial<FacilitatorClient> = {}): FacilitatorClient {
  return {
    verify: vi.fn().mockResolvedValue({ isValid: true }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      transaction: 'abc123def456',
      network: 'cardano:preview',
    }),
    status: vi.fn(),
    supported: vi.fn(),
    ...overrides,
  } as unknown as FacilitatorClient;
}

function createMockRequest(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    url: '/test',
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  } as unknown as FastifyRequest;
}

function createMockReply(): FastifyReply & {
  statusCode: number;
  sentHeaders: Record<string, string>;
  sent: boolean;
  sentBody: unknown;
} {
  const mock = {
    statusCode: 200,
    sentHeaders: {} as Record<string, string>,
    sent: false,
    sentBody: undefined as unknown,
    status: vi.fn().mockImplementation((code: number) => {
      mock.statusCode = code;
      return mock;
    }),
    header: vi.fn().mockImplementation((key: string, value: string) => {
      mock.sentHeaders[key] = value;
      return mock;
    }),
    send: vi.fn().mockImplementation((body?: unknown) => {
      mock.sent = true;
      mock.sentBody = body;
      return mock;
    }),
  };
  return mock as unknown as FastifyReply & typeof mock;
}

/** Build a valid base64-encoded PaymentSignaturePayload */
function createPaymentSignature(overrides: Record<string, unknown> = {}): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'cardano:preview',
      amount: '2000000',
      payTo: 'addr_test1qz_recipient',
      maxTimeoutSeconds: 300,
      asset: 'lovelace',
      extra: null,
    },
    payload: {
      transaction: 'base64txdata',
      payer: 'addr_test1qz_payer',
    },
    resource: {
      description: 'Test resource',
      mimeType: 'application/json',
      url: 'http://localhost/test',
    },
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

const DEFAULT_OPTIONS: PaymentGateOptions = {
  facilitator: createMockFacilitator(),
  payTo: 'addr_test1qz_recipient',
  amount: '2000000',
  network: 'cardano:preview',
};

/** Create the payment gate handler, cast to remove Fastify `this` binding for unit tests */
function createHandler(opts: PaymentGateOptions): HandlerFn {
  return createPaymentGate(opts) as unknown as HandlerFn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPaymentGate', () => {
  let facilitator: FacilitatorClient;
  let options: PaymentGateOptions;

  beforeEach(() => {
    facilitator = createMockFacilitator();
    options = { ...DEFAULT_OPTIONS, facilitator };
  });

  // ---- No payment header ----

  describe('no Payment-Signature header', () => {
    it('should return 402 when header is absent', async () => {
      const handler = createHandler(options);
      const request = createMockRequest();
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });

    it('should set Payment-Required header with base64 payload', async () => {
      const handler = createHandler(options);
      const request = createMockRequest();
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.header).toHaveBeenCalledWith('Payment-Required', expect.any(String));
      // Decode and verify the payment required header
      const headerValue = (reply.header as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf-8'));
      expect(decoded.x402Version).toBe(2);
      expect(decoded.accepts[0].payTo).toBe('addr_test1qz_recipient');
      expect(decoded.accepts[0].amount).toBe('2000000');
      expect(decoded.accepts[0].network).toBe('cardano:preview');
    });
  });

  // ---- Invalid payment header ----

  describe('invalid Payment-Signature header', () => {
    it('should return 402 for invalid base64', async () => {
      const handler = createHandler(options);
      const request = createMockRequest({ 'payment-signature': '!!!not-base64!!!' });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });

    it('should return 402 for valid base64 but invalid JSON', async () => {
      const handler = createHandler(options);
      const invalidBase64 = Buffer.from('not json at all {{{').toString('base64');
      const request = createMockRequest({ 'payment-signature': invalidBase64 });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });

    it('should return 402 for JSON that does not match schema', async () => {
      const handler = createHandler(options);
      const invalidPayload = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
      const request = createMockRequest({ 'payment-signature': invalidPayload });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });
  });

  // ---- Verification failure ----

  describe('verification failure', () => {
    it('should return 402 when verify returns isValid: false', async () => {
      (facilitator.verify as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        isValid: false,
        invalidReason: 'recipient_mismatch',
      });

      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });

    it('should include invalidReason in 402 error field', async () => {
      (facilitator.verify as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        isValid: false,
        invalidReason: 'amount_too_low',
      });

      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      // Decode the Payment-Required header to check error field
      const headerValue = (reply.header as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf-8'));
      expect(decoded.error).toBe('amount_too_low');
    });

    it('should return 402 when verify throws', async () => {
      (facilitator.verify as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });
  });

  // ---- Settlement failure ----

  describe('settlement failure', () => {
    it('should return 402 when settle returns success: false', async () => {
      (facilitator.settle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        reason: 'submission_failed',
      });

      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });

    it('should return 402 when settle throws', async () => {
      (facilitator.settle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Settlement timeout')
      );

      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.status).toHaveBeenCalledWith(402);
      expect(reply.sent).toBe(true);
    });
  });

  // ---- Success flow ----

  describe('success flow', () => {
    it('should not send a reply (allows through to route handler)', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.sent).toBe(false);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should accept the X-PAYMENT request header alias', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'x-payment': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      expect(reply.sent).toBe(false);
      expect(facilitator.verify).toHaveBeenCalledTimes(1);
      expect(facilitator.settle).toHaveBeenCalledTimes(1);
    });

    it('accepts X-PAYMENT through a real Fastify request', async () => {
      const app = fastify({ logger: false });
      app.get('/paid', { preHandler: createPaymentGate(options) }, async () => ({ ok: true }));

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/paid',
          headers: { 'X-PAYMENT': createPaymentSignature() },
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true });
        expect(response.headers['x-payment-response']).toBeDefined();
        expect(facilitator.verify).toHaveBeenCalledTimes(1);
        expect(facilitator.settle).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    });

    it('should attach x402Settlement to request', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      const augmented = request as FastifyRequest & { x402Settlement?: unknown };
      expect(augmented.x402Settlement).toEqual({
        success: true,
        transaction: 'abc123def456',
        network: 'cardano:preview',
        extensions: { status: 'confirmed' },
      });
    });

    it('should set both X-Payment-Response and PAYMENT-RESPONSE headers on reply', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      const headerCalls = (reply.header as ReturnType<typeof vi.fn>).mock.calls;
      const headerNames = headerCalls.map((c) => c[0]);
      expect(headerNames).toContain('X-Payment-Response');
      expect(headerNames).toContain('PAYMENT-RESPONSE');

      // Decode and verify the canonical header value
      const xCall = headerCalls.find((c) => c[0] === 'X-Payment-Response');
      expect(xCall).toBeDefined();
      const headerValue = xCall![1] as string;
      const decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf-8'));
      expect(decoded.success).toBe(true);
      expect(decoded.transaction).toBe('abc123def456');
      expect(decoded.network).toBe('cardano:preview');
      expect(decoded.extensions).toEqual({ status: 'confirmed' });
    });
  });

  // ---- Field mapping ----

  describe('field mapping', () => {
    it('should map amount to amount in verify request', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      const verifyCall = (facilitator.verify as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(verifyCall.paymentRequirements.amount).toBe('2000000');
      expect(verifyCall.paymentRequirements.payTo).toBe('addr_test1qz_recipient');
      expect(verifyCall.paymentRequirements.network).toBe('cardano:preview');
      expect(verifyCall.paymentRequirements.scheme).toBe('exact');
    });

    it('should use server-owned network in verify accepted payload', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature({
        accepted: {
          scheme: 'exact',
          network: 'cardano:mainnet',
          amount: '1',
          payTo: 'addr_test1qz_attacker',
          maxTimeoutSeconds: 1,
          asset: 'lovelace',
          extra: null,
        },
      });
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      const verifyCall = (facilitator.verify as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(verifyCall.paymentPayload.accepted.network).toBe('cardano:preview');
      expect(verifyCall.paymentPayload.accepted.amount).toBe('2000000');
      expect(verifyCall.paymentPayload.accepted.payTo).toBe('addr_test1qz_recipient');
      expect(verifyCall.paymentPayload.accepted.maxTimeoutSeconds).toBe(300);
    });

    it('should pass transaction to settle request', async () => {
      const handler = createHandler(options);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      const settleCall = (facilitator.settle as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(settleCall.paymentPayload.payload.transaction).toBe('base64txdata');
      expect(settleCall.paymentRequirements.amount).toBe('2000000');
    });

    it('should use custom asset and maxTimeoutSeconds when provided', async () => {
      const customOptions: PaymentGateOptions = {
        ...options,
        asset: 'policyId.assetName',
        maxTimeoutSeconds: 600,
      };
      const handler = createHandler(customOptions);
      const signature = createPaymentSignature();
      const request = createMockRequest({ 'payment-signature': signature });
      const reply = createMockReply();

      await handler(request, reply, vi.fn());

      const verifyCall = (facilitator.verify as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(verifyCall.paymentRequirements.asset).toBe('policyId.assetName');
      expect(verifyCall.paymentRequirements.maxTimeoutSeconds).toBe(600);
    });
  });
});
