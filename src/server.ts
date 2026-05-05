import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { ServiceCatalog } from './catalog.js';
import { createChainProvider, createRedisClient, disconnectRedis } from './chain/index.js';
import type { Config } from './config/index.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { requestLoggerPlugin } from './plugins/request-logger.js';
import { demoRoutesPlugin } from './routes/demo.js';
import { downloadRoutesPlugin } from './routes/download.js';
import { healthRoutesPlugin } from './routes/health.js';
import { settleRoutesPlugin } from './routes/settle.js';
import { statusRoutesPlugin } from './routes/status.js';
import { supportedRoutesPlugin } from './routes/supported.js';
import { uploadRoutesPlugin } from './routes/upload.js';
import { verifyRoutesPlugin } from './routes/verify.js';
import { wellKnownRoutesPlugin } from './routes/well-known.js';
import { createStorageBackend } from './storage/index.js';

// Import types to ensure augmentation is loaded
import './types/index.js';

export interface CreateServerOptions {
  config: Config;
}

export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const { config } = options;
  const isDev = config.env === 'development';

  const server = fastify({
    logger: {
      level: config.logging.level,
      transport: config.logging.pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
    // Request ID handling
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    // Disable default request logging (we use custom plugin)
    disableRequestLogging: true,
    // Security: Strict body limit (50KB) to prevent memory exhaustion
    bodyLimit: 51200,
  });

  // Zod type provider compilers (enables Zod schemas in route schema declarations)
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // Decorate server with config for access in routes
  server.decorate('config', config);

  // Security headers
  await server.register(helmet, {
    global: true,
    // CSP can be customized per-route if needed
    contentSecurityPolicy: isDev
      ? false
      : {
          useDefaults: true,
          directives: {
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
            'img-src': ["'self'", 'data:'],
            'connect-src': ["'self'"],
          },
        },
  });

  // Rate limiting
  await server.register(rateLimit, {
    max: config.rateLimit.global,
    timeWindow: config.rateLimit.windowMs,
    // use default in-memory store for now
  });

  // CORS - permissive in dev, restrictive in prod
  await server.register(cors, {
    origin: isDev ? true : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      // Payment-Signature is the request-side header name from the x402
      // Cardano spec; we accept both the canonical PAYMENT-SIGNATURE casing
      // and the kebab-case form (HTTP headers are case-insensitive on the
      // wire, but CORS allowlists must enumerate them).
      'Payment-Signature',
      'PAYMENT-SIGNATURE',
      'Payment-Required',
    ],
    // Both header names are emitted in parallel. See sdk/types.ts.
    exposedHeaders: ['Payment-Required', 'X-Payment-Response', 'PAYMENT-RESPONSE'],
  });

  // Multipart support (file uploads)
  await server.register(multipart);

  // Custom plugins
  await server.register(errorHandlerPlugin, { isDev });
  await server.register(requestLoggerPlugin, { isDev });

  // ---- OpenAPI documentation ----
  await server.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'x402 Cardano Payment Facilitator',
        description:
          'Cardano x402 payment facilitator API for verifying and settling blockchain payments.',
        version: '1.0.0',
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      servers: [{ url: 'http://localhost:3000', description: 'Development' }],
      tags: [
        { name: 'Health', description: 'Server health and capabilities' },
        { name: 'Facilitator', description: 'Payment verification and settlement' },
        { name: 'Storage', description: 'File upload and download (reference implementation)' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // ---- Chain layer initialization ----
  try {
    const redis = createRedisClient(config.chain.redis, server.log);
    await redis.connect();
    server.decorate('redis', redis);

    server.log.info(
      {
        network: config.chain.network,
        tier: config.chain.blockfrost.tier,
        redis: `${config.chain.redis.host}:${config.chain.redis.port}`,
      },
      'Chain layer: Redis connected'
    );

    const chainProvider = await createChainProvider(config.chain, redis, server.log);
    server.decorate('chainProvider', chainProvider);

    server.log.info({ network: config.chain.network }, 'Chain layer initialized');

    // Shutdown hook for Redis disconnect
    server.addHook('onClose', async () => {
      await disconnectRedis(redis);
      server.log.info('Chain layer shutdown complete');
    });
  } catch (error) {
    server.log.error(
      { err: error instanceof Error ? error.message : 'Unknown error' },
      'Chain layer initialization failed'
    );
    throw error;
  }

  // ---- Storage layer initialization ----
  const storage = createStorageBackend(config.storage);
  server.decorate('storage', storage);
  server.log.info({ backend: config.storage.backend }, 'Storage layer initialized');

  // ---- Service catalog (paid-route registry for /.well-known/ discovery) ----
  const catalog = new ServiceCatalog();
  catalog.setServer({
    name: 'cardano402',
    description:
      'Open-source x402 payment facilitator and resource server SDK for Cardano.',
    contact: 'https://github.com/MorganOnCode/cardano402',
    url: undefined,
  });
  server.decorate('catalog', catalog);

  // Routes
  await server.register(healthRoutesPlugin);
  await server.register(verifyRoutesPlugin);
  await server.register(settleRoutesPlugin);
  await server.register(statusRoutesPlugin);
  await server.register(supportedRoutesPlugin);
  await server.register(uploadRoutesPlugin);
  await server.register(downloadRoutesPlugin);
  await server.register(demoRoutesPlugin);
  await server.register(wellKnownRoutesPlugin);

  // Landing page — serve landing/index.html at / (and static assets)
  // Must be registered after API routes so /docs etc. take precedence
  await server.register(staticFiles, {
    root: resolve(process.cwd(), 'landing'),
    prefix: '/',
    // Don't redirect /foo to /foo/ — keep SPA-style routing clean
    redirect: false,
    // Serve index.html for /
    index: 'index.html',
  });

  return server;
}
