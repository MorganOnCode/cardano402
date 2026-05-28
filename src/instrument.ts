// Sentry initialization + PII scrubbing.
//
// Loaded once at process boot from src/index.ts. The Sentry SDK installs
// global handlers, so this file MUST be imported before any code that
// might throw if you want those errors captured.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as Sentry from '@sentry/node';

// Headers + body keys that MUST NEVER reach Sentry. Listed lowercase
// because Node's request layer lowercases header names; we also defend
// against the canonical casings emitted by other clients.
const REDACTED = '[REDACTED]';
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'x-payment',
  'x-payment-signature',
  'x-payment-response',
  'payment-signature',
  'payment-response',
  'x-api-key',
  'api-key',
  'set-cookie',
]);

// Event keys that an accidental `extra: { ... }` could ship to Sentry. If a
// future error-handler refactor stuffs config, payment payloads, or chain
// secrets into Sentry.captureException's extras, this catches nested values too.
const SENSITIVE_EXTRA_KEYS =
  /seed|mnemonic|private[_-]?key|password|projectid|api[_-]?key|secret|authorization|payment[_-]?header|payment[_-]?payload|payment[_-]?signature|transaction[_-]?cbor/i;

function scrubValue(value: unknown, seen: WeakSet<object>): unknown {
  if (!value || typeof value !== 'object') return value;

  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubValue(value[i], seen);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SENSITIVE_EXTRA_KEYS.test(key)) {
      record[key] = REDACTED;
    } else {
      record[key] = scrubValue(record[key], seen);
    }
  }

  return value;
}

/**
 * Pure scrubber exposed for testing. Removes request bodies, sensitive
 * headers + cookies, and any `extra.*` key whose name pattern-matches a
 * secret-ish word.
 *
 * Operates on the passed event in-place (Sentry's beforeSend hands us
 * its own working copy) and returns the same reference. We never return
 * null — letting Sentry drop the event entirely would lose ops signal.
 */
export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  const req = event.request;
  if (req) {
    if (req.headers && typeof req.headers === 'object') {
      for (const key of Object.keys(req.headers)) {
        if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
          (req.headers as Record<string, unknown>)[key] = REDACTED;
        }
      }
    }
    if (req.cookies && typeof req.cookies === 'object') {
      req.cookies = { [REDACTED]: REDACTED };
    }
    // Request bodies can contain raw CBOR / payer addresses / nonce
    // values. Easier to drop everything than to try to allowlist.
    if (req.data !== undefined) {
      req.data = REDACTED;
    }
    // Query string can carry the same things as headers in misconfigured
    // clients; redact rather than try to parse + filter.
    if (req.query_string !== undefined) {
      req.query_string = REDACTED;
    }
  }

  // Defensive extras scrub: catches a future `Sentry.captureException(err,
  // { extra: { config } })` mistake before it ships nested seed material.
  if (event.extra && typeof event.extra === 'object') {
    scrubValue(event.extra, new WeakSet<object>());
  }

  return event;
}

/**
 * Resolve a release tag for Sentry. Prefer the build-time SHA Docker
 * passes in via BUILD_SHA so the running image maps to a specific commit;
 * fall back to the package version so the tag is always meaningful.
 */
function resolveRelease(): string {
  if (process.env.BUILD_SHA && process.env.BUILD_SHA.length > 0) {
    return process.env.BUILD_SHA;
  }
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
      version: string;
    };
    return `cardano402@${pkg.version}`;
  } catch {
    return 'cardano402@unknown';
  }
}

/**
 * Initialize Sentry. No-ops cleanly when no DSN is configured.
 */
export function initSentry(
  dsn: string | undefined,
  environment: string,
  tracesSampleRate = 0.1
): void {
  if (!dsn) {
    console.log('Sentry DSN not configured, error tracking disabled');
    return;
  }

  const release = resolveRelease();

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    profilesSampleRate: tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (transaction) => scrubSentryEvent(transaction),
    integrations: [Sentry.onUnhandledRejectionIntegration()],
  });

  console.log(`Sentry initialized for environment: ${environment} (release ${release})`);
}

// Re-export Sentry for use in error handler + the shutdown flush in index.ts.
export { Sentry };
