import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

import { redactUrlQuery } from './safe-url.js';

interface RequestLoggerOptions {
  isDev: boolean;
}

const requestLogger: FastifyPluginCallback<RequestLoggerOptions> = (fastify, options, done) => {
  const { isDev } = options;

  // Log incoming requests
  fastify.addHook('onRequest', async (request) => {
    const logData: Record<string, unknown> = {
      method: request.method,
      url: redactUrlQuery(request.url),
      requestId: request.id,
      userAgent: request.headers['user-agent'],
    };

    // Full body in dev, metadata only in prod (per CONTEXT.md)
    if (isDev && request.body) {
      logData.body = request.body;
    }

    request.log.info(logData, 'Incoming request');
  });

  // Log completed responses
  fastify.addHook('onResponse', async (request, reply) => {
    const logData: Record<string, unknown> = {
      method: request.method,
      url: redactUrlQuery(request.url),
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
      requestId: request.id,
    };

    // Log at appropriate level based on status code
    if (reply.statusCode >= 500) {
      request.log.error(logData, 'Request completed with server error');
    } else if (reply.statusCode >= 400) {
      request.log.warn(logData, 'Request completed with client error');
    } else {
      request.log.info(logData, 'Request completed');
    }
  });

  done();
};

export const requestLoggerPlugin = fp(requestLogger, {
  name: 'request-logger',
  fastify: '5.x',
});
