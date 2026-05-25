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

import { boundedRouteLabel } from '../plugins/safe-url.js';

const SKIP_ROUTES = new Set(['/metrics', '/health']);
const PAYMENT_ROUTES = new Set(['/verify', '/settle', '/status']);

function bearerToken(headers: Record<string, unknown>): string | undefined {
  const value = headers.authorization;
  if (typeof value !== 'string') return undefined;
  const [scheme, token] = value.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

function parseJsonPayload(payload: unknown): unknown {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return undefined;
    }
  }
  if (Buffer.isBuffer(payload)) {
    try {
      return JSON.parse(payload.toString('utf8')) as unknown;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function boundedReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'none';
  const normalized = value.trim();
  return /^[a-z0-9_:-]{1,80}$/u.test(normalized) ? normalized : 'other';
}

function classifyPaymentResult(route: string, body: unknown): { result: string; reason: string } {
  if (body === null || typeof body !== 'object') {
    return { result: 'unparseable', reason: 'non_json_response' };
  }

  const record = body as Record<string, unknown>;
  if (route === '/verify') {
    return record.isValid === true
      ? { result: 'valid', reason: 'none' }
      : { result: 'invalid', reason: boundedReason(record.invalidReason) };
  }
  if (route === '/settle') {
    return record.success === true
      ? { result: 'success', reason: 'none' }
      : { result: 'failure', reason: boundedReason(record.errorReason) };
  }
  if (route === '/status') {
    return { result: boundedReason(record.status), reason: 'none' };
  }

  return { result: 'unknown', reason: 'unknown_route' };
}

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

  const paymentResultTotal = new Counter({
    name: 'facilitator_payment_results_total',
    help: 'Payment protocol results for facilitator endpoints, labeled by endpoint, result, and bounded reason',
    labelNames: ['endpoint', 'result', 'reason'],
    registers: [registry],
  });

  fastify.addHook('onSend', async (request, _reply, payload) => {
    const route = boundedRouteLabel(request.routeOptions?.url);
    if (!PAYMENT_ROUTES.has(route)) return payload;

    const parsed = parseJsonPayload(payload);
    const { result, reason } = classifyPaymentResult(route, parsed);
    paymentResultTotal.labels(route, result, reason).inc();
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    // Prefer the route pattern (e.g. "/files/:cid") over the raw URL so
    // cardinality stays bounded. Unmatched paths collapse to one label.
    const route = boundedRouteLabel(request.routeOptions?.url);
    if (SKIP_ROUTES.has(route)) return;
    const method = request.method;
    const statusCode = String(reply.statusCode);
    const elapsedMs = reply.elapsedTime;
    httpDuration.labels(method, route, statusCode).observe(elapsedMs / 1000);
    httpTotal.labels(method, route, statusCode).inc();
  });

  fastify.get('/metrics', async (req, reply) => {
    const expectedToken = fastify.config?.metrics?.bearerToken;
    if (expectedToken && bearerToken(req.headers) !== expectedToken) {
      return reply.status(401).send('Unauthorized\n');
    }

    const body = await registry.metrics();
    return reply.type(registry.contentType).status(200).send(body);
  });

  done();
};

export const metricsRoutesPlugin = fp(metricsPlugin, {
  name: 'metrics-routes',
  fastify: '5.x',
});
