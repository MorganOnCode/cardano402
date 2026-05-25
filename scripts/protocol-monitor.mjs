#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://cardano402.com';
const DEFAULT_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.CARDANO402_MONITOR_BASE_URL ?? DEFAULT_BASE_URL,
    timeoutMs: Number(process.env.CARDANO402_MONITOR_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--base-url') {
      i += 1;
      options.baseUrl = argv[i];
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
    } else if (arg === '--timeout-ms') {
      i += 1;
      options.timeoutMs = Number(argv[i]);
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/protocol-monitor.mjs [options]

Checks that public cardano402/x402 protocol endpoints are reachable by agents.

Options:
  --base-url <url>      Base service URL (default: ${DEFAULT_BASE_URL})
  --timeout-ms <ms>     Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --json               Emit JSON result details
  --help               Show this help

Environment:
  CARDANO402_MONITOR_BASE_URL
  CARDANO402_MONITOR_TIMEOUT_MS`);
}

function joinUrl(baseUrl, path) {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function fetchJson(baseUrl, path, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = joinUrl(baseUrl, path);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'cardano402-protocol-monitor/1.0',
      },
      signal: controller.signal,
    });

    const bodyText = await response.text();
    const cfMitigated = response.headers.get('cf-mitigated');
    const contentType = response.headers.get('content-type') ?? '';

    if (cfMitigated === 'challenge') {
      fail(`${path} is behind an interactive Cloudflare challenge`, {
        status: response.status,
        cfMitigated,
      });
    }
    if (!response.ok) {
      fail(`${path} returned HTTP ${response.status}`, {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    if (!contentType.toLowerCase().includes('application/json')) {
      fail(`${path} did not return JSON`, {
        status: response.status,
        contentType,
        body: bodyText.slice(0, 500),
      });
    }

    try {
      return {
        status: response.status,
        headers: {
          contentType,
          cfMitigated,
          ratelimit: response.headers.get('ratelimit'),
        },
        body: JSON.parse(bodyText),
      };
    } catch {
      fail(`${path} returned invalid JSON`, {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function assertWellKnown(body) {
  if (body?.x402Version !== 2) fail('/.well-known/x402.json has wrong x402Version', { body });
  if (typeof body.server?.name !== 'string') fail('/.well-known/x402.json is missing server.name', { body });
  if (!Array.isArray(body.endpoints)) fail('/.well-known/x402.json is missing endpoints[]', { body });
}

function assertHealth(body) {
  if (!['healthy', 'degraded'].includes(body?.status)) {
    fail('/health is not healthy/degraded', { body });
  }
}

function assertSupported(body) {
  if (!Array.isArray(body?.kinds) || body.kinds.length === 0) {
    fail('/supported is missing supported kinds', { body });
  }
  const hasCardanoExact = body.kinds.some(
    (kind) =>
      kind?.x402Version === 2 &&
      kind?.scheme === 'exact' &&
      typeof kind?.network === 'string' &&
      kind.network.startsWith('cardano:')
  );
  if (!hasCardanoExact) fail('/supported does not advertise x402 v2 exact on Cardano', { body });
}

async function checkEndpoint(baseUrl, timeoutMs, path, assertion) {
  const result = await fetchJson(baseUrl, path, timeoutMs);
  assertion(result.body);
  return {
    path,
    ok: true,
    status: result.status,
    ratelimit: result.headers.ratelimit,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [
    ['/.well-known/x402.json', assertWellKnown],
    ['/health', assertHealth],
    ['/supported', assertSupported],
  ];

  const results = [];
  for (const [path, assertion] of checks) {
    results.push(await checkEndpoint(options.baseUrl, options.timeoutMs, path, assertion));
  }

  if (options.json) {
    console.log(JSON.stringify({ baseUrl: options.baseUrl, ok: true, results }, null, 2));
  } else {
    for (const result of results) {
      console.log(`ok ${result.path} HTTP ${result.status}`);
    }
  }
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    details: error?.details,
  };
  if (process.argv.includes('--json')) {
    console.error(JSON.stringify(payload, null, 2));
  } else {
    console.error(`protocol monitor failed: ${payload.error}`);
    if (payload.details) console.error(JSON.stringify(payload.details, null, 2));
  }
  process.exit(1);
});
