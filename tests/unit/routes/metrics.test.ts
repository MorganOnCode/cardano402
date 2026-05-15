import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

    it('labels by method and status_code', async () => {
      await server.inject({ method: 'GET', url: '/sample' });
      const res = await server.inject({ method: 'GET', url: '/metrics' });
      expect(res.body).toMatch(/method="GET"/);
      expect(res.body).toMatch(/status_code="200"/);
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
