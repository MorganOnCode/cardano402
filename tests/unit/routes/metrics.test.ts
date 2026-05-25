import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../../src/config/index.js';
import { metricsRoutesPlugin } from '../../../src/routes/metrics.js';

describe('Metrics routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = fastify({ logger: false });
    await server.register(metricsRoutesPlugin);
    // Sample routes for traffic that should be tracked
    server.get('/sample', async () => ({ ok: true }));
    server.get('/files/:cid', async (req) => ({ cid: (req.params as { cid: string }).cid }));
    server.get('/health', async () => ({ status: 'ok' }));
    server.post('/verify', async (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      return body?.valid
        ? { isValid: true }
        : { isValid: false, invalidReason: body?.reason ?? 'invalid_request' };
    });
    server.post('/settle', async (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      return body?.success
        ? { success: true, transaction: 'tx1', network: 'cardano:preview' }
        : { success: false, errorReason: body?.reason ?? 'invalid_request' };
    });
    server.post('/status', async () => ({ status: 'confirmed', transaction: 'tx1' }));
    await server.ready();
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  describe('GET /metrics', () => {
    it('returns 200 with Prometheus text/plain content type', async () => {
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-type']).toContain('version=0.0.4');
    });

    it('exposes default Node.js process metrics', async () => {
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/# HELP process_cpu_user_seconds_total/);
      expect(res.body).toMatch(/# HELP nodejs_heap_size_total_bytes/);
      expect(res.body).toMatch(/# HELP nodejs_eventloop_lag_seconds/);
    });

    it('exposes the http_requests_total counter and http_request_duration_seconds histogram', async () => {
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/# HELP http_requests_total/);
      expect(res.body).toMatch(/# HELP http_request_duration_seconds/);
    });

    it('attaches a service="cardano402" default label', async () => {
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/service="cardano402"/);
    });

    it('rejects requests without the configured bearer token', async () => {
      const protectedServer = fastify({ logger: false });
      protectedServer.decorate('config', {
        metrics: { bearerToken: 'test-metrics-bearer-token' },
      } as Partial<Config> as Config);
      await protectedServer.register(metricsRoutesPlugin);
      await protectedServer.ready();

      try {
        const res = await protectedServer.inject({ method: 'GET', url: '/metrics' });
        expect(res.statusCode).toBe(401);
      } finally {
        await protectedServer.close();
      }
    });

    it('returns metrics with the configured bearer token', async () => {
      const protectedServer = fastify({ logger: false });
      protectedServer.decorate('config', {
        metrics: { bearerToken: 'test-metrics-bearer-token' },
      } as Partial<Config> as Config);
      await protectedServer.register(metricsRoutesPlugin);
      await protectedServer.ready();

      try {
        const res = await protectedServer.inject({
          method: 'GET',
          url: '/metrics',
          headers: { authorization: 'Bearer test-metrics-bearer-token' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatch(/# HELP process_cpu_user_seconds_total/);
      } finally {
        await protectedServer.close();
      }
    });
  });

  describe('HTTP request tracking', () => {
    it('tracks the request count for tracked routes', async () => {
      await server.inject({ method: 'GET', url: '/sample' });
      await server.inject({ method: 'GET', url: '/sample' });
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/http_requests_total\{[^}]*route="\/sample"[^}]*\}\s+2/);
      expect(res.body).toMatch(
        /http_request_duration_seconds_count\{[^}]*route="\/sample"[^}]*\}\s+2/
      );
    });

    it('uses the route pattern not the raw URL (bounded cardinality)', async () => {
      await server.inject({ method: 'GET', url: '/files/abc123' });
      await server.inject({ method: 'GET', url: '/files/xyz789' });
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      // Both calls collapse onto a single time series for the templated route
      expect(res.body).toMatch(/http_requests_total\{[^}]*route="\/files\/:cid"[^}]*\}\s+2/);
      // The raw cids are NOT present as labels (would explode cardinality)
      expect(res.body).not.toMatch(/route="\/files\/abc123"/);
      expect(res.body).not.toMatch(/route="\/files\/xyz789"/);
    });

    it('collapses unmatched paths instead of labeling raw URLs or query strings', async () => {
      await server.inject({ method: 'GET', url: '/unknown-a?token=secret' });
      await server.inject({ method: 'GET', url: '/unknown-b?paymentHeader=secret' });

      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/http_requests_total\{[^}]*route="__unmatched__"[^}]*\}\s+2/);
      expect(res.body).not.toContain('/unknown-a');
      expect(res.body).not.toContain('/unknown-b');
      expect(res.body).not.toContain('paymentHeader=secret');
      expect(res.body).not.toContain('token=secret');
    });

    it('labels by method and status_code', async () => {
      await server.inject({ method: 'GET', url: '/sample' });
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/method="GET"/);
      expect(res.body).toMatch(/status_code="200"/);
    });
  });

  describe('Payment protocol result tracking', () => {
    it('counts verify valid and invalid outcomes with bounded reasons', async () => {
      await server.inject({ method: 'POST', url: '/verify', payload: { valid: true } });
      await server.inject({
        method: 'POST',
        url: '/verify',
        payload: { reason: 'nonce_lookup_failed' },
      });

      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(
        /facilitator_payment_results_total\{[^}]*endpoint="\/verify"[^}]*result="valid"[^}]*reason="none"[^}]*\}\s+1/
      );
      expect(res.body).toMatch(
        /facilitator_payment_results_total\{[^}]*endpoint="\/verify"[^}]*result="invalid"[^}]*reason="nonce_lookup_failed"[^}]*\}\s+1/
      );
    });

    it('counts settle failures and status outcomes', async () => {
      await server.inject({
        method: 'POST',
        url: '/settle',
        payload: { reason: 'settlement_timeout' },
      });
      await server.inject({ method: 'POST', url: '/status', payload: { transaction: 'tx1' } });

      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(
        /facilitator_payment_results_total\{[^}]*endpoint="\/settle"[^}]*result="failure"[^}]*reason="settlement_timeout"[^}]*\}\s+1/
      );
      expect(res.body).toMatch(
        /facilitator_payment_results_total\{[^}]*endpoint="\/status"[^}]*result="confirmed"[^}]*reason="none"[^}]*\}\s+1/
      );
    });

    it('bounds unexpected reason labels to avoid cardinality abuse', async () => {
      await server.inject({
        method: 'POST',
        url: '/verify',
        payload: { reason: 'attacker supplied reason with spaces and punctuation !!!' },
      });

      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(
        /facilitator_payment_results_total\{[^}]*endpoint="\/verify"[^}]*result="invalid"[^}]*reason="other"[^}]*\}\s+1/
      );
      expect(res.body).not.toContain('attacker supplied reason');
    });
  });

  describe('Excluded routes', () => {
    it('does NOT track requests to /metrics (avoid recursive accounting)', async () => {
      await server.inject({ method: 'GET', url: '/metrics' });
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).not.toMatch(/http_requests_total\{[^}]*route="\/metrics"[^}]*\}/);
    });

    it('does NOT track requests to /health (liveness-probe noise)', async () => {
      await server.inject({ method: 'GET', url: '/health' });
      await server.inject({ method: 'GET', url: '/health' });
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).not.toMatch(/http_requests_total\{[^}]*route="\/health"[^}]*\}/);
    });
  });
});
