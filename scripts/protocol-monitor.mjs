#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://cardano402.com';
const MACHINE_ENDPOINTS = [
  { method: 'GET', path: '/.well-known/x402.json', expectJson: true },
  { method: 'GET', path: '/supported', expectJson: true },
  { method: 'POST', path: '/verify', expectJson: true, body: { x402Version: 2 } },
  { method: 'POST', path: '/settle', expectJson: true, body: { x402Version: 2 } },
];

function parseArgs(argv) {
  const out = { baseUrl: DEFAULT_BASE_URL, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--base-url') {
      out.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      out.baseUrl = arg.slice('--base-url='.length);
    }
  }
  return out;
}

function hasCloudflareChallenge(response) {
  const mitigated = response.headers.get('cf-mitigated');
  const server = response.headers.get('server');
  const contentType = response.headers.get('content-type') ?? '';
  return (
    mitigated === 'challenge' ||
    (server?.toLowerCase() === 'cloudflare' &&
      response.status === 403 &&
      contentType.toLowerCase().includes('text/html'))
  );
}

async function checkEndpoint(baseUrl, endpoint) {
  const url = new URL(endpoint.path, baseUrl);
  const init = {
    method: endpoint.method,
    headers: {
      accept: 'application/json',
      'user-agent': 'cardano402-protocol-monitor/1.0',
    },
  };
  if (endpoint.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(endpoint.body);
  }

  const started = Date.now();
  let response;
  let text = '';
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch (error) {
    return {
      path: endpoint.path,
      method: endpoint.method,
      ok: false,
      reason: 'network_error',
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }

  const challenged = hasCloudflareChallenge(response);
  let jsonOk = true;
  if (endpoint.expectJson && !challenged) {
    try {
      JSON.parse(text);
    } catch {
      jsonOk = false;
    }
  }

  const statusOk =
    endpoint.path === '/verify' || endpoint.path === '/settle'
      ? response.status === 200 || response.status === 400
      : response.status >= 200 && response.status < 300;
  const ok = statusOk && jsonOk && !challenged;

  return {
    path: endpoint.path,
    method: endpoint.method,
    ok,
    status: response.status,
    reason: challenged
      ? 'cloudflare_challenge'
      : !statusOk
        ? 'unexpected_status'
        : !jsonOk
          ? 'non_json_response'
          : undefined,
    contentType: response.headers.get('content-type'),
    cfMitigated: response.headers.get('cf-mitigated'),
    durationMs: Date.now() - started,
  };
}

const args = parseArgs(process.argv.slice(2));
const checks = await Promise.all(
  MACHINE_ENDPOINTS.map((endpoint) => checkEndpoint(args.baseUrl, endpoint))
);
const ok = checks.every((check) => check.ok);
const result = {
  ok,
  baseUrl: args.baseUrl,
  checkedAt: new Date().toISOString(),
  checks,
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const check of checks) {
    const marker = check.ok ? 'OK' : 'FAIL';
    const suffix = check.reason ? ` (${check.reason})` : '';
    console.log(`${marker} ${check.method} ${check.path} ${check.status ?? ''}${suffix}`);
  }
}

if (!ok) process.exit(1);
