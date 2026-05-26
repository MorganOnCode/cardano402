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
  'packages/core/src/header.ts',
  'MAX_PAYMENT_HEADER_LENGTH',
  'Payment header decoding must bound public header size before base64/JSON parsing.'
);
requireIncludes(
  'src/sdk/payment-gate.ts',
  'findPaymentHeader(request.headers)',
  'Payment gate must use shared payment header lookup for casing and Node-style array handling.'
);
requireIncludes(
  'src/sdk/payment-gate.ts',
  'decodePaymentSignatureHeader(paymentHeader)',
  'Payment gate must use shared strict payment signature decoding instead of permissive Buffer base64 decoding.'
);
requireIncludes(
  'tests/unit/sdk/payment-gate.test.ts',
  'oversized payment headers before verification',
  'Payment gate tests must prove oversized payment headers are rejected before facilitator verification.'
);
requireIncludes(
  'packages/mcp-server/src/payment.ts',
  'decodePaymentRequiredHeader(headerValue)',
  'MCP clients must strictly decode untrusted Payment-Required headers before signing.'
);
requireIncludes(
  'packages/mcp-server/test/payment.test.ts',
  'refuses oversized Payment-Required headers before signing',
  'MCP payment tests must prove oversized Payment-Required headers are rejected before signing.'
);
requireIncludes(
  'packages/mcp-server/src/payment.ts',
  'PaymentResponseHeaderSchema',
  'MCP clients must schema-check payment response headers before surfacing payment metadata.'
);
requireIncludes(
  'packages/mcp-server/src/payment.ts',
  'MAX_PAYMENT_HEADER_LENGTH',
  'MCP clients must bound payment response headers before base64/JSON parsing.'
);
requireIncludes(
  'packages/mcp-server/test/payment.test.ts',
  'returns null payment for malformed X-Payment-Response header',
  'MCP payment tests must prove malformed payment response headers are not surfaced.'
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
requireIncludes(
  'src/routes/download.ts',
  'isSupportedContentId',
  'Download route must validate content identifiers before storage backend lookup.'
);
requireIncludes(
  'tests/integration/download-route.test.ts',
  'should reject malformed content identifiers before storage lookup',
  'Download route tests must prove malformed content identifiers do not reach storage.'
);
requireIncludes(
  'src/routes/upload.ts',
  'UPLOAD_MULTIPART_LIMITS',
  'Upload route must pass explicit multipart limits instead of relying on global parser defaults.'
);
requireIncludes(
  'src/routes/upload.ts',
  'request.file({ limits: UPLOAD_MULTIPART_LIMITS })',
  'Upload route must enforce the intended upload size policy at the multipart parser.'
);
requireIncludes(
  'tests/integration/upload-route.test.ts',
  'should accept files larger than the global JSON body limit when under upload limit',
  'Upload tests must prove multipart upload limit is independent from the global JSON body limit.'
);
requireIncludes(
  'tests/integration/upload-route.test.ts',
  'should reject files over the upload limit before storage write',
  'Upload tests must prove oversized files are rejected before storage writes.'
);
requireIncludes(
  'src/settle/settle-payment.ts',
  'function isTxHash',
  'Settlement dedup handling must validate transaction hashes before Redis keys or chain lookups.'
);
requireIncludes(
  'src/settle/settle-payment.ts',
  'Settlement dedup record is not valid JSON',
  'Settlement dedup handling must turn corrupt Redis JSON into a structured failure.'
);
requireIncludes(
  'tests/unit/settle/settle-payment.test.ts',
  'returns internal_error when a dedup record is not valid JSON',
  'Settlement tests must cover corrupt Redis JSON dedup records.'
);
requireIncludes(
  'tests/unit/settle/settle-payment.test.ts',
  'returns internal_error when a dedup record has a malformed txHash',
  'Settlement tests must cover malformed txHash dedup records.'
);
requireIncludes(
  'packages/core/src/schemas.ts',
  'Lovelace amount must fit in uint64',
  'Lovelace amount schema must bound public payment amounts before BigInt conversion.'
);
requireIncludes(
  'tests/integration/verify-route.test.ts',
  'over-uint64 payment amounts before verification',
  'Verify route tests must prove oversized payment amounts are rejected before verification.'
);
requireIncludes(
  'tests/integration/settle-route.test.ts',
  'over-uint64 payment amounts before settlement',
  'Settle route tests must prove oversized payment amounts are rejected before settlement.'
);
requireIncludes(
  'src/verify/request-shape.ts',
  'decodePaymentHeader(envelope.paymentHeader)',
  'Verify/settle request normalisation must strictly decode raw paymentHeader bodies.'
);
requireIncludes(
  'src/verify/request-shape.ts',
  'paymentHeader: z.string().max(MAX_PAYMENT_HEADER_LENGTH)',
  'Verify/settle request envelopes must bound raw paymentHeader bodies before normalisation.'
);
requireIncludes(
  'tests/unit/verify/request-shape.test.ts',
  'returns invalid_base64 when paymentHeader exceeds the strict header limit',
  'Request-shape tests must prove oversized raw paymentHeader bodies are rejected.'
);
requireIncludes(
  'tests/integration/verify-route.test.ts',
  'malformed paymentHeader before verification',
  'Verify route tests must prove malformed raw paymentHeader bodies do not reach verification.'
);
requireIncludes(
  'tests/integration/settle-route.test.ts',
  'malformed paymentHeader before settlement',
  'Settle route tests must prove malformed raw paymentHeader bodies do not reach settlement.'
);
requireIncludes(
  'src/verify/cbor.ts',
  'MAX_TRANSACTION_CBOR_BASE64_LENGTH',
  'Transaction CBOR decoding must bound signed transaction payload size.'
);
requireIncludes(
  'src/routes/settle.ts',
  'decodeTransactionCborBase64(paymentPayload.payload.transaction)',
  'Settle route must strictly decode transaction CBOR before settlement submission.'
);
requireIncludes(
  'tests/integration/settle-route.test.ts',
  'malformed transaction base64 before settlement',
  'Settle route tests must prove malformed transaction CBOR does not reach settlement.'
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
