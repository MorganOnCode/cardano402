import fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { requestLoggerPlugin } from '../../../src/plugins/request-logger.js';

function makeLogSink() {
  const records: Record<string, unknown>[] = [];
  return {
    records,
    stream: {
      write(line: string) {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        records.push(JSON.parse(trimmed) as Record<string, unknown>);
      },
    },
  };
}

describe('requestLoggerPlugin', () => {
  it('does not log request bodies even in development mode', async () => {
    const sink = makeLogSink();
    const server = fastify({
      logger: { stream: sink.stream, level: 'info' },
      disableRequestLogging: true,
    });

    await server.register(requestLoggerPlugin, { isDev: true });
    server.post('/verify', async () => ({ ok: true }));
    await server.ready();

    try {
      await server.inject({
        method: 'POST',
        url: '/verify',
        payload: {
          paymentPayload: {
            payload: {
              transaction: 'base64-cbor-that-must-not-be-logged',
            },
          },
        },
      });
    } finally {
      await server.close();
    }

    const incoming = sink.records.find((record) => record.msg === 'Incoming request');
    expect(incoming).toBeDefined();
    expect(incoming).not.toHaveProperty('body');
    expect(JSON.stringify(sink.records)).not.toContain('base64-cbor-that-must-not-be-logged');
  });

  it('redacts query strings in logged URLs', async () => {
    const sink = makeLogSink();
    const server = fastify({
      logger: { stream: sink.stream, level: 'info' },
      disableRequestLogging: true,
    });

    await server.register(requestLoggerPlugin, { isDev: false });
    server.get('/health', async () => ({ ok: true }));
    await server.ready();

    try {
      await server.inject({
        method: 'GET',
        url: '/health?paymentHeader=secret',
      });
    } finally {
      await server.close();
    }

    const logText = JSON.stringify(sink.records);
    expect(logText).toContain('/health?[REDACTED]');
    expect(logText).not.toContain('paymentHeader=secret');
  });
});
