#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function requireFile(path) {
  if (!existsSync(join(ROOT, path))) fail(`Missing required release/security file: ${path}`);
}

function requireIncludes(path, needle, message) {
  const text = read(path);
  if (!text.includes(needle)) fail(message ?? `${path} must include ${needle}`);
}

const requiredWorkflows = [
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/dependency-review.yml',
  '.github/workflows/gitleaks.yml',
  '.github/workflows/osv-scanner.yml',
  '.github/workflows/scorecard.yml',
  '.github/workflows/zizmor.yml',
  '.github/workflows/protocol-monitor.yml',
];

for (const workflow of requiredWorkflows) requireFile(workflow);

requireIncludes(
  '.github/workflows/ci.yml',
  'pnpm audit --prod --audit-level=moderate',
  'CI security job must run a blocking production dependency audit at moderate severity.'
);
requireIncludes(
  '.github/workflows/ci.yml',
  'pnpm security:payments',
  'CI security job must run payment-specific invariants.'
);
requireIncludes(
  '.github/workflows/ci.yml',
  'pnpm security:release',
  'CI security job must run release readiness invariants.'
);
requireFile('semgrep/payment-security.yml');
requireIncludes(
  'package.json',
  'security:semgrep',
  'Package scripts must expose the optional Semgrep payment-security ruleset.'
);
requireIncludes(
  '.github/workflows/protocol-monitor.yml',
  '--min-confirmations "$MIN_CONFIRMATIONS"',
  'Protocol monitor workflow must enforce configured confirmation depth.'
);
requireIncludes(
  'scripts/protocol-monitor.mjs',
  'missing_signer_policy',
  'Protocol monitor must validate root signer posture from /health.'
);
requireIncludes(
  'scripts/protocol-monitor.mjs',
  'min_confirmations_too_low',
  'Protocol monitor must validate minimum confirmation depth from /health.'
);
requireIncludes(
  'src/routes/metrics.ts',
  'facilitator_payment_results_total',
  'Metrics must expose payment outcome counters for abuse monitoring.'
);
requireIncludes(
  'src/index.ts',
  'config.sentry?.environment ?? config.env',
  'Sentry initialization must honor sentry.environment when configured.'
);
requireIncludes(
  'src/plugins/error-handler.ts',
  'redactUrlQuery(request.url)',
  'Error handler must redact query strings before logging or sending URL context to Sentry.'
);
if (read('src/plugins/request-logger.ts').includes('logData.body')) {
  fail('Request logger must not attach request bodies to logs.');
}
requireIncludes(
  'src/server.ts',
  'disableRequestLogging: true',
  'Fastify automatic request logging must stay disabled so URL redaction is controlled by request-logger.'
);
requireIncludes(
  'src/routes/metrics.ts',
  'boundedRouteLabel(request.routeOptions?.url)',
  'Metrics route labels must use bounded route patterns instead of raw request URLs.'
);
requireIncludes(
  'src/sdk/payment-gate.ts',
  "settleResult.extensions?.status",
  'Payment gate must inspect settlement confirmation status before serving protected routes.'
);
requireIncludes(
  'src/sdk/payment-gate.ts',
  "settlementStatus !== 'confirmed'",
  'Payment gate must reject mempool or missing settlement status before serving protected routes.'
);
requireIncludes(
  'src/verify/checks.ts',
  'invalid_pay_to',
  'Verification must turn malformed payment recipient addresses into structured invalid_pay_to failures.'
);
requireIncludes(
  'src/verify/verify-payment.ts',
  'Payment requirements contain an invalid recipient address',
  'Verification responses must retain a human-readable invalid_pay_to message.'
);
requireIncludes(
  'packages/core/src/schemas.ts',
  '^[0-9a-f]{64}$',
  'Status requests must require 64-character lowercase hex transaction hashes.'
);
requireIncludes(
  'tests/integration/status-route.test.ts',
  'not.toHaveBeenCalled()',
  'Status route tests must prove invalid transaction hashes do not query Blockfrost.'
);

const packageJson = JSON.parse(read('package.json'));
if (packageJson.scripts?.prepublishOnly !== 'pnpm build') {
  fail('Root package prepublishOnly must run pnpm build.');
}
for (const workspacePackage of ['packages/core/package.json', 'packages/mcp-server/package.json']) {
  const workspace = JSON.parse(read(workspacePackage));
  if (!String(workspace.scripts?.prepublishOnly ?? '').includes('pnpm test')) {
    fail(`${workspacePackage} prepublishOnly must include tests.`);
  }
}

requireIncludes(
  'docs/security-review-2026-05-25.md',
  'Tool recommendations',
  'Security review must retain tool recommendations section.'
);
requireIncludes(
  'docs/goal-progress-2026-05-25.md',
  'Original goal prompt',
  'Goal progress report must retain the original goal prompt.'
);
requireIncludes(
  'docs/mainnet-signer-isolation.md',
  'remote-policy',
  'Mainnet signer isolation plan must keep the remote policy signer target.'
);

if (failures.length > 0) {
  console.error('Release readiness check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release readiness check passed');
