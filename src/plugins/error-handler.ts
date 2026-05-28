import type { FastifyPluginCallback, FastifyError } from 'fastify';
import fp from 'fastify-plugin';

import { redactUrlQuery } from './safe-url.js';
import { Sentry } from '../instrument.js';

interface ErrorHandlerOptions {
  isDev: boolean;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    stack?: string;
  };
  requestId: string;
  timestamp: string;
}

const errorHandler: FastifyPluginCallback<ErrorHandlerOptions> = (fastify, options, done) => {
  const { isDev } = options;

  // Handle thrown errors
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.code ?? 'INTERNAL_ERROR';
    const safeUrl = redactUrlQuery(request.url);

    // Log the error
    request.log.error(
      {
        err: error,
        code,
        statusCode,
      },
      'Request error'
    );

    // Capture server errors in Sentry
    if (statusCode >= 500) {
      Sentry.captureException(error, {
        extra: {
          requestId: request.id,
          url: safeUrl,
          method: request.method,
        },
      });
    }

    const response: ErrorResponse = {
      error: {
        code,
        message: isDev ? error.message : sanitizeMessage(error.message, code, statusCode),
        statusCode,
        // Only include stack in development
        ...(isDev && error.stack && { stack: error.stack }),
      },
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };

    reply.status(statusCode).send(response);
  });

  // Handle 404 not found with consistent format
  fastify.setNotFoundHandler((request, reply) => {
    const safeUrl = redactUrlQuery(request.url);
    const response: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method}:${safeUrl} not found`,
        statusCode: 404,
      },
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };

    request.log.warn(
      {
        method: request.method,
        url: safeUrl,
        requestId: request.id,
      },
      'Route not found'
    );

    reply.status(404).send(response);
  });

  done();
};

function sanitizeMessage(message: string, code: string, statusCode: number): string {
  // Allow rate limit messages
  if (statusCode === 429) {
    return message;
  }
  // In production, return generic messages for internal errors
  if (code === 'INTERNAL_ERROR' || code.startsWith('SERVER_')) {
    return 'An internal error occurred';
  }
  // Config errors should be visible (they're startup issues)
  if (code.startsWith('CONFIG_')) {
    return message;
  }
  // Default: return the message (it's likely user-facing)
  return message;
}

export const errorHandlerPlugin = fp(errorHandler, {
  name: 'error-handler',
  fastify: '5.x',
});
