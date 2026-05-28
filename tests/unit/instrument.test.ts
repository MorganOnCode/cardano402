// Unit tests for the Sentry PII scrubber.
//
// The scrubber is the load-bearing piece of the Sentry hardening pass —
// it's what prevents the seed phrase / payer addresses / Authorization
// tokens from leaking to Sentry if a downstream refactor accidentally
// attaches them to an event (via extra, request body capture, etc.).

import type * as Sentry from '@sentry/node';
import { describe, expect, it } from 'vitest';

import { scrubSentryEvent } from '../../src/instrument.js';

const REDACTED = '[REDACTED]';

function makeEvent(overrides: Partial<Sentry.Event> = {}): Sentry.Event {
  return {
    event_id: 'e1',
    timestamp: 1700000000,
    ...overrides,
  };
}

describe('scrubSentryEvent', () => {
  it('redacts authorization header (lowercase)', () => {
    const event = makeEvent({
      request: { headers: { authorization: 'Bearer SECRET' } },
    });
    scrubSentryEvent(event);
    expect(event.request?.headers?.authorization).toBe(REDACTED);
  });

  it('redacts Authorization header (canonical casing)', () => {
    const event = makeEvent({
      request: { headers: { Authorization: 'Bearer SECRET' } },
    });
    scrubSentryEvent(event);
    expect((event.request?.headers as Record<string, unknown>)?.Authorization).toBe(REDACTED);
  });

  it('redacts X-PAYMENT and PAYMENT-SIGNATURE in both casings', () => {
    const event = makeEvent({
      request: {
        headers: {
          'x-payment': 'cbor-bytes-here',
          'X-PAYMENT-SIGNATURE': 'sig',
          'payment-signature': 'sig2',
          'X-Payment-Response': 'resp',
        },
      },
    });
    scrubSentryEvent(event);
    const h = event.request?.headers as Record<string, unknown>;
    expect(h['x-payment']).toBe(REDACTED);
    expect(h['X-PAYMENT-SIGNATURE']).toBe(REDACTED);
    expect(h['payment-signature']).toBe(REDACTED);
    expect(h['X-Payment-Response']).toBe(REDACTED);
  });

  it('redacts cookies entirely (the whole object collapses to a single placeholder)', () => {
    const event = makeEvent({
      request: { cookies: { session: 'abc', csrf: 'def' } },
    });
    scrubSentryEvent(event);
    expect(event.request?.cookies).toEqual({ [REDACTED]: REDACTED });
  });

  it('redacts request body (data) wholesale', () => {
    const event = makeEvent({
      request: {
        data: {
          paymentPayload: { payload: { transaction: 'base64-cbor', payer: 'addr_test1qz...' } },
        },
      },
    });
    scrubSentryEvent(event);
    expect(event.request?.data).toBe(REDACTED);
  });

  it('redacts query_string', () => {
    const event = makeEvent({
      request: { query_string: 'token=secret&foo=bar' },
    });
    scrubSentryEvent(event);
    expect(event.request?.query_string).toBe(REDACTED);
  });

  it('preserves non-sensitive headers (e.g. user-agent, x-request-id)', () => {
    const event = makeEvent({
      request: {
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'req-123',
          accept: 'application/json',
        },
      },
    });
    scrubSentryEvent(event);
    const h = event.request?.headers as Record<string, unknown>;
    expect(h['user-agent']).toBe('Mozilla/5.0');
    expect(h['x-request-id']).toBe('req-123');
    expect(h.accept).toBe('application/json');
  });

  it('redacts extra.* keys whose names suggest secrets', () => {
    const event = makeEvent({
      extra: {
        requestId: 'safe',
        seedPhrase: 'twelve word seed here',
        blockfrostProjectId: 'mainnet_KEY',
        userPassword: 'pw',
        url: '/verify',
      },
    });
    scrubSentryEvent(event);
    expect(event.extra?.requestId).toBe('safe');
    expect(event.extra?.url).toBe('/verify');
    expect(event.extra?.seedPhrase).toBe(REDACTED);
    expect(event.extra?.blockfrostProjectId).toBe(REDACTED);
    expect(event.extra?.userPassword).toBe(REDACTED);
  });

  it('redacts nested extra values whose names suggest secrets or payment payloads', () => {
    const event = makeEvent({
      extra: {
        config: {
          chain: {
            facilitator: {
              seedPhrase: 'seed words',
              privateKeyFile: '/run/secrets/facilitator.skey',
            },
            blockfrost: {
              projectId: 'project-secret',
            },
          },
        },
        payment: {
          paymentHeader: 'base64-payment',
          transactionCbor: 'base64-cbor',
        },
        attempts: [{ apiKey: 'api-secret' }, { safe: 'value' }],
      },
    });

    scrubSentryEvent(event);

    const extra = event.extra as Record<string, unknown>;
    const config = extra.config as {
      chain: { facilitator: Record<string, unknown>; blockfrost: Record<string, unknown> };
    };
    const payment = extra.payment as Record<string, unknown>;
    const attempts = extra.attempts as Record<string, unknown>[];

    expect(config.chain.facilitator.seedPhrase).toBe(REDACTED);
    expect(config.chain.facilitator.privateKeyFile).toBe(REDACTED);
    expect(config.chain.blockfrost.projectId).toBe(REDACTED);
    expect(payment.paymentHeader).toBe(REDACTED);
    expect(payment.transactionCbor).toBe(REDACTED);
    expect(attempts[0].apiKey).toBe(REDACTED);
    expect(attempts[1].safe).toBe('value');
  });

  it('is a no-op when request and extra are absent', () => {
    const event = makeEvent({});
    const before = JSON.stringify(event);
    scrubSentryEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });

  it('returns the same event reference (mutates in place)', () => {
    const event = makeEvent({ request: { headers: { authorization: 'x' } } });
    const result = scrubSentryEvent(event);
    expect(result).toBe(event);
  });

  it('preserves narrowed event type (generic signature)', () => {
    // Type-level check: passing a SeverityLevel-tagged Event keeps the
    // narrower type on the way out. Compilation success is the assertion.
    const errorEvent: Sentry.ErrorEvent = {
      type: undefined,
      event_id: 'e2',
      timestamp: 1700000001,
      level: 'error',
    };
    const result = scrubSentryEvent(errorEvent);
    // narrowed to ErrorEvent — TS sees `.level` as accessible
    expect(result.level).toBe('error');
  });
});
