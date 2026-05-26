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

function requireDockerignoreEntry(entry, message) {
  const entries = read('.dockerignore')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (!entries.includes(entry)) fail(message);
}

function requireWorkflowPinnedPnpm(path) {
  const text = read(path);
  const actionUses = text.match(/pnpm\/action-setup@/g)?.length ?? 0;
  const pinnedVersions = text.match(/version: 10\.8\.1/g)?.length ?? 0;
  if (actionUses !== pinnedVersions) {
    fail(`${path} must pin every pnpm/action-setup invocation to pnpm 10.8.1.`);
  }
}

function requireDependabotEcosystem(ecosystem) {
  requireIncludes(
    '.github/dependabot.yml',
    `package-ecosystem: "${ecosystem}"`,
    `Dependabot must cover the ${ecosystem} ecosystem.`
  );
}

function getDependabotUpdateBlock(ecosystem) {
  const text = read('.github/dependabot.yml');
  const start = text.indexOf(`  - package-ecosystem: "${ecosystem}"`);
  if (start === -1) return '';
  const next = text.indexOf('\n  - package-ecosystem:', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

function requireDependabotCooldown(ecosystem, needles) {
  const block = getDependabotUpdateBlock(ecosystem);
  if (block === '') {
    fail(`Dependabot must cover the ${ecosystem} ecosystem.`);
    return;
  }
  if (!block.includes('cooldown:')) {
    fail(`Dependabot ${ecosystem} updates must define a cooldown block.`);
  }
  for (const needle of needles) {
    if (!block.includes(needle)) {
      fail(`Dependabot ${ecosystem} cooldown must include ${needle}.`);
    }
  }
}

function requirePackageFiles(path, expectedFiles) {
  const packageJson = JSON.parse(read(path));
  const actual = packageJson.files;
  if (!Array.isArray(actual)) {
    fail(`${path} must define an explicit npm files allowlist.`);
    return;
  }
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expectedFiles].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    fail(`${path} npm files allowlist must be exactly: ${normalizedExpected.join(', ')}.`);
  }
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

requireFile('.github/dependabot.yml');
requireDependabotEcosystem('npm');
requireDependabotEcosystem('github-actions');
requireDependabotEcosystem('docker');
requireDependabotCooldown('npm', [
  'default-days: 7',
  'semver-major-days: 30',
  'semver-minor-days: 7',
  'semver-patch-days: 3',
]);
requireDependabotCooldown('github-actions', ['default-days: 7']);
requireDependabotCooldown('docker', ['default-days: 7']);

requireWorkflowPinnedPnpm('.github/workflows/ci.yml');
requireWorkflowPinnedPnpm('.github/workflows/protocol-monitor.yml');

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
  'src/config/schema.ts',
  'bearerToken: z.string().min(32).optional()',
  'Production metrics bearer tokens must require at least 32 characters.'
);
requireIncludes(
  'src/routes/metrics.ts',
  'timingSafeEqual',
  'Metrics bearer token checks must use constant-time comparison.'
);
requireIncludes(
  'tests/unit/routes/metrics.test.ts',
  'rejects bearer headers with extra whitespace in the token value',
  'Metrics tests must prove malformed bearer headers are rejected.'
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
  'src/server.ts',
  "methods: ['GET', 'POST', 'OPTIONS']",
  'CORS preflight methods must stay limited to the public GET/POST API surface.'
);
requireIncludes(
  'scripts/backup.sh',
  'require_private_file "$ENV_FILE" "restic env file"',
  'Backup script must reject loose permissions on the restic credential env file.'
);
requireIncludes(
  'scripts/restore.sh',
  'require_private_file "$ENV_FILE" "restic env file"',
  'Restore script must reject loose permissions on the restic credential env file.'
);
requireIncludes(
  'scripts/restore.sh',
  'chmod 700 "$TARGET"',
  'Restore script must force private permissions on restore targets containing secrets.'
);
requireIncludes(
  'docker-compose.yml',
  '127.0.0.1:3000:3000',
  'Production facilitator port must bind to loopback for reverse-proxy exposure.'
);
requireIncludes(
  'docker-compose.yml',
  '127.0.0.1:6380:6379',
  'Production Redis port must not bind publicly.'
);
requireIncludes(
  'docker-compose.yml',
  '${REDIS_PASSWORD:?REDIS_PASSWORD is required for redis-prod}',
  'Production Redis must fail fast when REDIS_PASSWORD is unset.'
);
requireIncludes(
  'docker-compose.yml',
  '--maxmemory-policy noeviction',
  'Production Redis must use noeviction so settlement dedup keys are not silently evicted.'
);
requireIncludes(
  'docker-compose.yml',
  'no-new-privileges:true',
  'Production containers must opt into no-new-privileges.'
);
requireIncludes(
  'docker-compose.yml',
  'cap_drop:',
  'Production containers must drop ambient Linux capabilities.'
);
requireIncludes(
  'docker-compose.yml',
  './secrets:/run/secrets:ro',
  'Production facilitator must mount local signing files read-only at the documented /run/secrets path.'
);
requireIncludes(
  'docker-compose.yml',
  'read_only: true',
  'Production facilitator must run with a read-only root filesystem.'
);
requireIncludes(
  'docker-compose.yml',
  './data:/app/data',
  'Production facilitator must write uploaded files only through an explicit data mount.'
);
requireIncludes(
  'docker-compose.yml',
  'NODE_ENV=production',
  'Production facilitator must run with NODE_ENV=production.'
);
requireIncludes(
  'docker-compose.yml',
  'MAINNET=${MAINNET:-false}',
  'Production facilitator must pass the MAINNET guardrail env var through Compose.'
);
requireIncludes(
  'docker-compose.yml',
  'CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER=${CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER:-false}',
  'Production facilitator must pass the Mainnet local-file hot-wallet acknowledgement through Compose.'
);
requireIncludes(
  'docker-compose.prod.yml',
  './secrets:/run/secrets:ro',
  'VPS production Compose must mount local signing files read-only at the documented /run/secrets path.'
);
requireIncludes(
  'docker-compose.prod.yml',
  'read_only: true',
  'VPS production facilitator must run with a read-only root filesystem.'
);
requireIncludes(
  'docker-compose.prod.yml',
  '${REDIS_PASSWORD:?REDIS_PASSWORD is required for redis}',
  'VPS production Redis must fail fast when REDIS_PASSWORD is unset.'
);
requireIncludes(
  'docker-compose.prod.yml',
  '--maxmemory-policy noeviction',
  'VPS production Redis must use noeviction so settlement dedup keys are not silently evicted.'
);
requireIncludes(
  'docker-compose.prod.yml',
  'no-new-privileges:true',
  'VPS production containers must opt into no-new-privileges.'
);
requireIncludes(
  'docker-compose.prod.yml',
  'CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER=${CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER:-false}',
  'VPS production facilitator must pass the Mainnet local-file hot-wallet acknowledgement through Compose.'
);
requireIncludes(
  'package.json',
  'docker compose --profile development up -d',
  'Development dependency script must not start production-profile services or rely on an empty default Compose profile.'
);
requireIncludes(
  'README.md',
  'config/config.development.example.json',
  'README quickstart must use the development config template instead of the production-shaped template.'
);
requireIncludes(
  'config/config.development.example.json',
  '"host": "127.0.0.1"',
  'Development config template must point host-run pnpm dev at local forwarded Redis.'
);
requireIncludes(
  'config/config.example.json',
  '"host": "redis-prod"',
  'Example production config must point at the production Redis service name.'
);
requireIncludes(
  'config/config.example.json',
  '"trustProxy": 2',
  'Example production config must use a numeric trusted-proxy hop count so rate limits use real client IPs without trusting arbitrary forwarded chains.'
);
requireIncludes(
  'config/config.development.example.json',
  '"trustProxy": false',
  'Development config template must not trust spoofable forwarded headers.'
);
requireIncludes(
  'src/server.ts',
  'trustProxy: config.server.trustProxy ?? false',
  'Fastify must wire numeric server.trustProxy hop counts into the HTTP server so rate limits/logs use proxy-aware client IPs when configured.'
);
requireIncludes(
  'src/config/schema.ts',
  'server.trustProxy must be a numeric trusted-proxy hop count in production',
  'Production config must reject boolean trustProxy true so forwarded headers cannot be trusted too broadly.'
);
requireIncludes(
  'tests/unit/config.test.ts',
  'rejects production env with boolean trustProxy true',
  'Config tests must prove production rejects broad boolean trustProxy true.'
);
requireIncludes(
  'scripts/backup.sh',
  '$REPO_ROOT/secrets',
  'Encrypted backups must include local signing files from the production secrets directory when present.'
);
requireDockerignoreEntry(
  'secrets',
  'Docker build context must exclude local signing files from secrets/.'
);
requireDockerignoreEntry(
  'data',
  'Docker build context must exclude runtime uploaded data from data/.'
);
requireIncludes(
  'Dockerfile',
  'corepack prepare pnpm@10.8.1 --activate',
  'Docker builds must activate the pinned packageManager pnpm version instead of Corepack defaults.'
);
requireIncludes(
  'src/config/schema.ts',
  'demo.seedPhraseFile is required when config.env is "production"',
  'Production demo configuration must reject inline demo seed material.'
);
requireIncludes(
  'src/chain/config.ts',
  'CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER',
  'Mainnet local-file facilitator signing must require explicit hot-wallet acknowledgement.'
);
requireIncludes(
  'tests/unit/config.test.ts',
  'rejects inline demo seed material in production',
  'Config tests must prove production demo seed material is file-based.'
);
requireIncludes(
  'src/routes/demo.ts',
  'max: fastify.config.rateLimit.sensitive',
  'Live demo route must use the tighter sensitive route rate limit.'
);
requireIncludes(
  'src/routes/demo.ts',
  'const configured = Boolean(fastify.config.demo)',
  'Live demo status must not report readiness when demo configuration is absent.'
);
requireIncludes(
  'src/routes/demo.ts',
  'ready: configured && !demoRunning && cooldownRemaining === 0',
  'Live demo status readiness must depend on configuration, concurrency, and cooldown state.'
);
requireIncludes(
  'tests/security/controls.test.ts',
  'should enforce tighter rate limits on /demo/run than global',
  'Security controls tests must prove the live demo route uses the sensitive limiter.'
);
requireIncludes(
  'tests/security/controls.test.ts',
  'should report demo status as not ready when demo config is absent',
  'Security controls tests must prove demo status is not ready without demo configuration.'
);
requireIncludes(
  'tests/security/controls.test.ts',
  'should enforce tighter rate limits on /demo/status than global',
  'Security controls tests must prove demo status uses the sensitive limiter.'
);
requireIncludes(
  'config/config.example.json',
  'seedPhraseFile',
  'Example config must steer demo wallet seed material to a restrictive file.'
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
  'src/sdk/payment-required.ts',
  'validatePaymentRequiredOptions',
  'Payment-Required quotes must be validated before being emitted to clients.'
);
requireIncludes(
  'src/sdk/payment-required.ts',
  'asset: AssetIdentifierSchema',
  'Payment-Required quotes must validate asset identifiers before being emitted to clients.'
);
requireIncludes(
  'src/sdk/payment-required.ts',
  'MAX_PAYMENT_REQUIRED_TIMEOUT_SECONDS',
  'Payment-Required quotes must bound maxTimeoutSeconds before clients sign against them.'
);
requireIncludes(
  'src/sdk/payment-gate.ts',
  'validatePaymentRequiredOptions',
  'Payment gates must reject misconfigured payment terms before serving requests.'
);
requireIncludes(
  'tests/unit/sdk/payment-required.test.ts',
  'rejects quotes with %s before encoding Payment-Required',
  'Payment-Required tests must prove malformed quotes are rejected before encoding.'
);
requireIncludes(
  'tests/unit/sdk/payment-gate.test.ts',
  'rejects misconfigured payment gates with %s before serving requests',
  'Payment gate tests must prove malformed payment terms are rejected at gate construction.'
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
  'packages/mcp-server/src/config.ts',
  'httpBearerToken: z.string().min(32).optional()',
  'MCP HTTP transport bearer tokens must require at least 32 characters.'
);
requireIncludes(
  'packages/mcp-server/src/server.ts',
  'timingSafeEqual',
  'MCP HTTP transport bearer token checks must use constant-time comparison.'
);
requireIncludes(
  'packages/mcp-server/src/server.ts',
  'MIN_HTTP_BEARER_TOKEN_LENGTH',
  'MCP HTTP transport startup must enforce the bearer-token floor even for programmatic callers.'
);
requireIncludes(
  'packages/mcp-server/test/config.test.ts',
  'rejects short HTTP bearer tokens',
  'MCP config tests must prove short HTTP bearer tokens are rejected.'
);
requireIncludes(
  'packages/mcp-server/test/http-transport.test.ts',
  'refuses short bearer tokens even when options bypass config parsing',
  'MCP HTTP transport tests must prove programmatic short tokens are rejected.'
);
requireIncludes(
  'packages/mcp-server/src/payment.ts',
  'MAX_PAYMENT_HEADER_LENGTH',
  'MCP clients must bound payment response headers before base64/JSON parsing.'
);
requireIncludes(
  'packages/mcp-server/src/catalog.ts',
  'amount: LovelaceAmountSchema',
  'MCP catalog parsing must reject malformed or over-uint64 catalog amounts before tool registration.'
);
requireIncludes(
  'packages/mcp-server/src/catalog.ts',
  'payTo: CardanoAddressSchema',
  'MCP catalog parsing must reject malformed recipient addresses before tool registration.'
);
requireIncludes(
  'packages/mcp-server/src/catalog.ts',
  'asset: AssetIdentifierSchema',
  'MCP catalog parsing must reject malformed asset identifiers before tool registration.'
);
requireIncludes(
  'packages/mcp-server/src/catalog.ts',
  'MAX_CATALOG_PAYMENT_TIMEOUT_SECONDS',
  'MCP catalog parsing must bound maxTimeoutSeconds before passing TTLs to the signer.'
);
requireIncludes(
  'packages/mcp-server/test/catalog.test.ts',
  'rejects catalog endpoints with %s',
  'MCP catalog tests must prove malformed payment requirements are rejected before tool registration.'
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
  'packages/core/src/schemas.ts',
  'AssetIdentifierSchema',
  'Core schemas must validate public asset identifiers before quote, verification, settlement, or signing paths consume them.'
);
requireIncludes(
  'packages/core/src/schemas.ts',
  '^[0-9a-f]{56}\\.[0-9a-f]{2,64}$',
  'Native asset identifiers must use lowercase policyId.assetNameHex form.'
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
  'src/routes/verify.ts',
  'paymentRequirements.maxTimeoutSeconds > verificationConfig.maxTimeoutSeconds',
  'Verify route must reject paymentRequirements.maxTimeoutSeconds above the configured maximum before verification.'
);
requireIncludes(
  'src/routes/settle.ts',
  'paymentRequirements.maxTimeoutSeconds > verificationConfig.maxTimeoutSeconds',
  'Settle route must reject paymentRequirements.maxTimeoutSeconds above the configured maximum before settlement.'
);
requireIncludes(
  'src/catalog.ts',
  'PaidEndpointSchema.parse(endpoint)',
  'Resource-server catalog registration must validate paid endpoint payment terms before publishing discovery manifests.'
);
requireIncludes(
  'src/catalog.ts',
  'amount: LovelaceAmountSchema',
  'Resource-server catalog registration must reject malformed or over-uint64 amounts before discovery publication.'
);
requireIncludes(
  'src/catalog.ts',
  'payTo: CardanoAddressSchema',
  'Resource-server catalog registration must reject malformed recipient addresses before discovery publication.'
);
requireIncludes(
  'src/catalog.ts',
  'asset: AssetIdentifierSchema',
  'Resource-server catalog registration must reject malformed asset identifiers before discovery publication.'
);
requireIncludes(
  'tests/unit/catalog.test.ts',
  'rejects paid routes with %s before publishing discovery',
  'ServiceCatalog tests must prove malformed paid routes are rejected before discovery publication.'
);
requireIncludes(
  'tests/integration/verify-route.test.ts',
  'payment timeouts above configured maximum before verification',
  'Verify route tests must prove over-policy payment timeouts do not reach verification.'
);
requireIncludes(
  'tests/integration/settle-route.test.ts',
  'payment timeouts above configured maximum before settlement',
  'Settle route tests must prove over-policy payment timeouts do not reach settlement.'
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
const rootPrepublishOnly = String(packageJson.scripts?.prepublishOnly ?? '');
requirePackageFiles('package.json', ['dist/', 'LICENSE', 'README.md']);
requirePackageFiles('packages/core/package.json', [
  'dist',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'SPEC_TRUTH.md',
]);
requirePackageFiles('packages/mcp-server/package.json', [
  'dist',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
]);
for (const requiredPublishGate of [
  'pnpm typecheck',
  'pnpm test -- --runInBand',
  'pnpm security:payments',
  'pnpm security:release',
  'pnpm build',
]) {
  if (!rootPrepublishOnly.includes(requiredPublishGate)) {
    fail(`Root package prepublishOnly must include ${requiredPublishGate}.`);
  }
}
for (const workspacePackage of ['packages/core/package.json', 'packages/mcp-server/package.json']) {
  const workspace = JSON.parse(read(workspacePackage));
  if (!String(workspace.scripts?.prepublishOnly ?? '').includes('pnpm test')) {
    fail(`${workspacePackage} prepublishOnly must include tests.`);
  }
}
for (const scaffoldPackage of [
  'packages/axios/package.json',
  'packages/express/package.json',
  'packages/fastify/package.json',
  'packages/fetch/package.json',
  'packages/hono/package.json',
  'packages/next/package.json',
]) {
  const scaffold = JSON.parse(read(scaffoldPackage));
  if (scaffold.private !== true) {
    fail(`${scaffoldPackage} must remain private until the adapter is implemented and release-reviewed.`);
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
