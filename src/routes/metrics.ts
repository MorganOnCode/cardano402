// Prometheus metrics endpoint.
//
// Exposes default Node.js process/runtime metrics (heap, GC, event loop)
// plus per-route HTTP request count + duration histogram, scrape-able by
// any Prometheus-compatible system. Mounted at GET /metrics.
//
// /metrics itself and /health are excluded from request tracking -- the
// former to avoid recursive accounting, the latter to keep liveness-probe
// noise out of latency percentiles.

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const SKIP_ROUTES = new Set(['/metrics', '/health']);

const metricsPlugin: FastifyPluginCallback = (fastify, _options, done) => {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'cardano402' });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, labeled by method, route, and status code',
    labelNames: ['method', 'route', 'status_code'],
    // Buckets cover the realistic facilitator latency band (sub-ms to a few seconds).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests, labeled by method, route, and status code',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });

  fastify.addHook('onResponse', async (request, reply) => {
    // Prefer the route pattern (e.g. "/files/:cid") over the raw URL so
    // cardinality stays bounded. Falls back to raw URL for unmatched paths.
    const route = request.routeOptions?.url ?? request.url;
    if (SKIP_ROUTES.has(route)) return;
    const method = request.method;
    const statusCode = String(reply.statusCode);
    const elapsedMs = reply.elapsedTime;
    httpDuration.labels(method, route, statusCode).observe(elapsedMs / 1000);
    httpTotal.labels(method, route, statusCode).inc();
  });

  fastify.get('/metrics', async (_req, reply) => {
    const body = await registry.metrics();
    return reply.type(registry.contentType).status(200).send(body);
  });

  done();
};

export const metricsRoutesPlugin = fp(metricsPlugin, {
  name: 'metrics-routes',
  fastify: '5.x',
});
