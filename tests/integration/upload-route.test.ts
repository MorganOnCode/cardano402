import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import type { Config } from '../../src/config/index.js';
import type { PaymentResponseHeader } from '../../src/sdk/types.js';

// Mock Lucid Evolution packages to prevent native module loading (libsodium)
vi.mock('@lucid-evolution/lucid', () => ({
  Lucid: vi.fn().mockResolvedValue({
    selectWallet: { fromSeed: vi.fn(), fromPrivateKey: vi.fn() },
    newTx: vi.fn(),
    config: vi.fn(),
    wallet: vi.fn().mockReturnValue({
      address: vi
        .fn()
        .mockResolvedValue(
          'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7'
        ),
    }),
  }),
}));
vi.mock('@lucid-evolution/provider', () => ({
  Blockfrost: vi.fn(),
}));

// Mock ioredis to prevent real Redis connections
vi.mock('ioredis', () => {
  class RedisMock {
    connect = vi.fn().mockResolvedValue(undefined);
    quit = vi.fn().mockResolvedValue(undefined);
    ping = vi.fn().mockResolvedValue('PONG');
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    del = vi.fn().mockResolvedValue(1);
    keys = vi.fn().mockResolvedValue([]);
    mget = vi.fn().mockResolvedValue([]);
    on = vi.fn().mockReturnThis();
    status = 'ready';
  }
  return { default: RedisMock };
});

// ---------------------------------------------------------------------------
// Mock the payment gate at module level.
// This lets us control whether payment passes or fails without needing the
// full x402 HTTP flow (already tested in 08-04).
// ---------------------------------------------------------------------------

/** Controls gate behavior for each test */
let gateMode: 'pass' | 'reject' = 'reject';

vi.mock('../../src/sdk/payment-gate.js', () => ({
  createPaymentGate: () => {
    return async function mockGateHandler(
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> {
      const paymentHeader = request.headers['payment-signature'] as string | undefined;

      if (gateMode === 'reject' || !paymentHeader) {
        // Return 402 with Payment-Required header (simplified mock)
        const headerValue = Buffer.from(
          JSON.stringify({
            x402Version: 2,
            error: null,
            resource: {
              description: 'File upload to x402 storage',
              mimeType: 'application/octet-stream',
              url: '/upload',
            },
            accepts: [
              {
                scheme: 'exact',
                network: 'cardano:preview',
                amount: '2000000',
                payTo: 'addr_test1qx...',
                maxTimeoutSeconds: 300,
                asset: 'lovelace',
                extra: null,
              },
            ],
          })
        ).toString('base64');
        void reply.status(402).header('Payment-Required', headerValue).send();
        return;
      }

      // Payment accepted -- set the X-Payment-Response header
      const paymentResponse: PaymentResponseHeader = {
        success: true,
        transaction: 'tx_mock_hash_123',
        network: 'cardano:preview',
      };
      (request as FastifyRequest & { x402Settlement?: PaymentResponseHeader }).x402Settlement =
        paymentResponse;
      const responseHeaderValue = Buffer.from(JSON.stringify(paymentResponse)).toString('base64');
      void reply.header('X-Payment-Response', responseHeaderValue);
    };
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const testConfig: Config = {
  server: { host: '0.0.0.0', port: 0 },
  logging: { level: 'error', pretty: false },
  rateLimit: { global: 100, windowMs: 60000, sensitive: 20 },
  env: 'test',
  chain: {
    network: 'Preview',
    blockfrost: { projectId: 'test-project-id', tier: 'free' },
    facilitator: { seedPhrase: 'test seed phrase for integration testing only' },
    cache: { utxoTtlSeconds: 60 },
    redis: { host: '127.0.0.1', port: 6379, db: 0 },
    verification: {
      graceBufferSeconds: 30,
      maxTimeoutSeconds: 300,
      feeMinLovelace: 150000,
      feeMaxLovelace: 5000000,
      requireNonce: false,
      confirmationMode: 'confirmed_only' as const,
      minConfirmations: 1,
    },
  },
  storage: {
    backend: 'fs' as const,
    fs: { dataDir: './data/files' },
    ipfs: { apiUrl: 'http://localhost:5001' },
  },
};

/** Create multipart form data boundary + body for file upload */
function createMultipartBody(filename: string, content: Buffer) {
  const boundary = '----TestBoundary123';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
    Buffer.from('Content-Type: application/octet-stream\r\n\r\n'),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /upload Route', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    server = await createServer({ config: testConfig });
    await server.listen({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    gateMode = 'reject'; // Default: payment required

    // Reset storage mock
    server.storage.put = vi.fn().mockResolvedValue('abc123def456');
    server.storage.get = vi.fn().mockResolvedValue(null);
    server.storage.has = vi.fn().mockResolvedValue(false);
    server.storage.healthy = vi.fn().mockResolvedValue(true);
  });

  // ---- No payment (402 flow) ----

  describe('No payment (402 flow)', () => {
    it('should return 402 when no Payment-Signature header is provided', async () => {
      const { body, boundary } = createMultipartBody('test.bin', Buffer.from('hello'));

      const response = await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(402);
    });

    it('should include Payment-Required header in 402 response', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/upload',
      });

      expect(response.statusCode).toBe(402);
      expect(response.headers['payment-required']).toBeDefined();
    });

    it('should decode Payment-Required header to valid x402 V2 JSON', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/upload',
      });

      const headerValue = response.headers['payment-required'] as string;
      const decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf-8'));
      expect(decoded.x402Version).toBe(2);
      expect(decoded.accepts).toBeInstanceOf(Array);
      expect(decoded.accepts[0].amount).toBe('2000000');
      expect(decoded.accepts[0].network).toBe('cardano:preview');
    });
  });

  // ---- Successful upload ----

  describe('Successful upload', () => {
    beforeEach(() => {
      gateMode = 'pass';
    });

    it('should return 200 with cid and size on successful upload', async () => {
      const fileContent = Buffer.from('test file content');
      const { body, boundary } = createMultipartBody('test.bin', fileContent);

      const response = await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'payment-signature': 'valid-payment-token',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.cid).toBe('abc123def456');
      expect(responseBody.size).toBe(fileContent.length);
    });

    it('should set X-Payment-Response header on successful upload', async () => {
      const fileContent = Buffer.from('test file content');
      const { body, boundary } = createMultipartBody('test.bin', fileContent);

      const response = await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'payment-signature': 'valid-payment-token',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-payment-response']).toBeDefined();
    });

    it('should call storage.put with the file data', async () => {
      const fileContent = Buffer.from('hello world');
      const { body, boundary } = createMultipartBody('test.bin', fileContent);

      await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'payment-signature': 'valid-payment-token',
        },
        payload: body,
      });

      expect(server.storage.put).toHaveBeenCalledOnce();
      const putArg = (server.storage.put as ReturnType<typeof vi.fn>).mock.calls[0][0] as Buffer;
      expect(putArg.toString()).toBe('hello world');
    });
  });

  // ---- Error handling ----

  describe('Error handling', () => {
    beforeEach(() => {
      gateMode = 'pass';
    });

    it('should return 400 when no file is in the multipart request', async () => {
      // Send a multipart body with only a text field (no file)
      const boundary = '----TestBoundary123';
      const body = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="notafile"\r\n\r\n` +
          `some text\r\n` +
          `--${boundary}--\r\n`
      );

      const response = await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'payment-signature': 'valid-payment-token',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toBe('Bad Request');
    });

    it('should return 500 when storage backend fails', async () => {
      (server.storage.put as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Storage write failed')
      );

      const fileContent = Buffer.from('test file');
      const { body, boundary } = createMultipartBody('test.bin', fileContent);

      const response = await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'payment-signature': 'valid-payment-token',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toBe('Internal Server Error');
    });
  });

  // ---- Invalid payment ----

  describe('Invalid payment', () => {
    it('should return 402 when payment gate rejects (no payment header)', async () => {
      gateMode = 'reject';

      const { body, boundary } = createMultipartBody('test.bin', Buffer.from('hello'));

      const response = await server.inject({
        method: 'POST',
        url: '/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'payment-signature': 'invalid-payment',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(402);
    });
  });

  // ---- Route existence ----

  it('should respond to POST /upload (not 404)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/upload',
    });

    // 402 is expected (no payment), not 404
    expect(response.statusCode).not.toBe(404);
  });
});
