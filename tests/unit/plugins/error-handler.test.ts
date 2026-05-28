import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { errorHandlerPlugin } from '../../../src/plugins/error-handler.js';

// Use vi.hoisted() so the mock fn is available before vi.mock hoisting
const { mockCaptureException } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
}));

// Mock @sentry/node before any imports that use it
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: mockCaptureException,
  onUnhandledRejectionIntegration: vi.fn(),
}));

/**
 * Helper to create a minimal Fastify server with error handler
 * and a test route that throws configurable errors.
 */
async function createTestServer(options: { isDev: boolean }): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
  });

  await server.register(errorHandlerPlugin, { isDev: options.isDev });

  // Test route that throws configurable errors
  server.post('/test-error', async (request) => {
    const { statusCode, code, message } = request.body as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    const err = new Error(message ?? 'Test error') as Error & {
      statusCode?: number;
      code?: string;
    };
    if (statusCode !== undefined) err.statusCode = statusCode;
    if (code !== undefined) err.code = code;
    throw err;
  });

  // Test route that always succeeds
  server.get('/test-ok', async () => {
    return { ok: true };
  });

  await server.ready();
  return server;
}

describe('Error Handler Plugin', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    if (server) await server.close();
    vi.clearAllMocks();
  });

  describe('Production mode error sanitization', () => {
    beforeEach(async () => {
      server = await createTestServer({ isDev: false });
    });

    it('should pass through rate limit (429) messages unchanged', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded, retry in 1 second',
        },
      });

      expect(response.statusCode).toBe(429);
      const body = response.json();
      expect(body.error.message).toBe('Rate limit exceeded, retry in 1 second');
    });

    it('should sanitize INTERNAL_ERROR messages to generic', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Sensitive internal details about database query',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.message).toBe('An internal error occurred');
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should sanitize SERVER_* error messages', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'SERVER_TIMEOUT',
          message: 'Connection to internal service timed out after 30s',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.message).toBe('An internal error occurred');
      expect(body.error.code).toBe('SERVER_TIMEOUT');
    });

    it('should pass through CONFIG_* error messages', async () => {
      const originalMessage = 'Invalid configuration: missing blockfrost key';
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'CONFIG_INVALID',
          message: originalMessage,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.message).toBe(originalMessage);
      expect(body.error.code).toBe('CONFIG_INVALID');
    });

    it('should pass through client error (400) messages', async () => {
      const originalMessage = 'Invalid CBOR format in transaction';
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 400,
          code: 'VERIFY_INVALID_FORMAT',
          message: originalMessage,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.message).toBe(originalMessage);
      expect(body.error.code).toBe('VERIFY_INVALID_FORMAT');
    });

    it('should pass through default messages not matching any sanitization rule', async () => {
      const originalMessage = 'Some user-facing error';
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: originalMessage,
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.error.message).toBe(originalMessage);
    });
  });

  describe('Sentry capture', () => {
    beforeEach(async () => {
      server = await createTestServer({ isDev: false });
    });

    it('should capture 500 errors in Sentry with request context', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Something broke',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(mockCaptureException).toHaveBeenCalledOnce();

      const [capturedError, capturedContext] = mockCaptureException.mock.calls[0];
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe('Something broke');
      expect(capturedContext.extra).toMatchObject({
        requestId: expect.any(String),
        url: '/test-error',
        method: 'POST',
      });
    });

    it('redacts query strings before sending URL context to Sentry', async () => {
      await server.inject({
        method: 'POST',
        url: '/test-error?paymentHeader=secret&token=abc',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Something broke',
        },
      });

      expect(mockCaptureException).toHaveBeenCalledOnce();
      const [, capturedContext] = mockCaptureException.mock.calls[0];
      expect(capturedContext.extra).toMatchObject({
        url: '/test-error?[REDACTED]',
      });
    });

    it('should NOT capture 400-level errors in Sentry', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 400,
          code: 'VERIFY_INVALID_FORMAT',
          message: 'Bad request',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('should capture 502 errors in Sentry', async () => {
      await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 502,
          code: 'SERVER_BAD_GATEWAY',
          message: 'Upstream failed',
        },
      });

      expect(mockCaptureException).toHaveBeenCalledOnce();
    });
  });

  describe('Development mode behavior', () => {
    beforeEach(async () => {
      server = await createTestServer({ isDev: true });
    });

    it('should include stack trace in dev mode', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Dev error with stack',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.stack).toBeDefined();
      expect(body.error.stack).toContain('Error: Dev error with stack');
    });

    it('should return raw message in dev mode (no sanitization)', async () => {
      const rawMessage = 'Sensitive internal details about database query';
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: rawMessage,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.message).toBe(rawMessage);
    });
  });

  describe('Not-found handler', () => {
    beforeEach(async () => {
      server = await createTestServer({ isDev: false });
    });

    it('should return structured 404 for unknown routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/nonexistent-route',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.statusCode).toBe(404);
      expect(body.error.message).toContain('/nonexistent-route');
      expect(body.error.message).toContain('GET');
    });

    it('should include requestId and timestamp in 404 responses', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/does-not-exist',
        headers: { 'x-request-id': 'test-req-404' },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.requestId).toBe('test-req-404');
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });

    it('redacts query strings from 404 response messages', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/missing-route?paymentHeader=secret',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.message).toContain('/missing-route?[REDACTED]');
      expect(body.error.message).not.toContain('paymentHeader=secret');
    });
  });

  describe('Response structure', () => {
    beforeEach(async () => {
      server = await createTestServer({ isDev: false });
    });

    it('should include requestId and timestamp in error responses', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'test',
        },
      });

      const body = response.json();
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });

    it('should default to 500 status and INTERNAL_ERROR code when not specified', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          message: 'Error without explicit status/code',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.statusCode).toBe(500);
    });

    it('should not include stack trace in production mode', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test-error',
        payload: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'test',
        },
      });

      const body = response.json();
      expect(body.error.stack).toBeUndefined();
    });
  });
});
