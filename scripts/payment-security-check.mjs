#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.md', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.turbo']);

const failures = [];

function fail(message) {
  failures.push(message);
}

function extension(path) {
  const last = path.lastIndexOf('.');
  return last === -1 ? '' : path.slice(last);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
    } else if (TEXT_EXTENSIONS.has(extension(path))) {
      files.push(path);
    }
  }
  return files;
}

function readRelative(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function checkPaymentGateAlias() {
  const source = readRelative('src/sdk/payment-gate.ts');
  if (!source.includes("request.headers['x-payment']")) {
    fail('src/sdk/payment-gate.ts must accept the base x402 X-PAYMENT request header alias.');
  }

  const tests = readRelative('tests/unit/sdk/payment-gate.test.ts');
  if (!tests.includes("'x-payment'")) {
    fail('tests/unit/sdk/payment-gate.test.ts must cover X-PAYMENT alias acceptance.');
  }

  const server = readRelative('src/server.ts');
  if (!server.includes("'X-PAYMENT'")) {
    fail('src/server.ts CORS allowedHeaders must include X-PAYMENT for browser clients.');
  }
}

function checkPaymentRequirementsTrustBoundary() {
  const suspicious = [
    /paymentRequirements\s*:\s*request\.body/u,
    /paymentRequirements\s*:\s*\(?request\.body\s+as/u,
    /paymentRequirements\s*:\s*body/u,
    /paymentRequirements\s*:\s*payload\.paymentRequirements/u,
  ];

  for (const path of walk(join(ROOT, 'src'))) {
    const text = readFileSync(path, 'utf8');
    for (const pattern of suspicious) {
      if (pattern.test(text)) {
        fail(
          `${path.slice(ROOT.length + 1)} appears to derive paymentRequirements from request/client data; requirements must come from server-side config.`
        );
      }
    }
  }

  const gate = readRelative('src/sdk/payment-gate.ts');
  for (const field of ['amount', 'asset', 'payTo', 'maxTimeoutSeconds']) {
    if (gate.includes(`${field}: payload.accepted.${field}`)) {
      fail(
        `src/sdk/payment-gate.ts must not trust payload.accepted.${field}; paymentRequirements.${field} must come from PaymentGateOptions.`
      );
    }
  }
}

function checkMcpSeedDocumentation() {
  const index = readRelative('packages/mcp-server/src/index.ts');
  if (index.includes('process.env.SEED_PHRASE!')) {
    fail(
      'packages/mcp-server/src/index.ts usage example must not encourage process.env.SEED_PHRASE hot seed material.'
    );
  }
}

checkPaymentGateAlias();
checkPaymentRequirementsTrustBoundary();
checkMcpSeedDocumentation();

if (failures.length > 0) {
  console.error('Payment security check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Payment security check passed');
