#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://cardano402.com';
const DEFAULT_MIN_CONFIRMATIONS = 6;
const MACHINE_ENDPOINTS = [
  { method: 'GET', path: '/.well-known/x402.json', expectJson: true },
  {
    method: 'GET',
    path: '/health',
    expectJson: true,
    validate: validateHealthPolicy,
  },
  { method: 'GET', path: '/supported', expectJson: true },
  { method: 'POST', path: '/verify', expectJson: true, body: { x402Version: 2 } },
  { method: 'POST', path: '/settle', expectJson: true, body: { x402Version: 2 } },
];

function parseArgs(argv) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    json: false,
    minConfirmations: DEFAULT_MIN_CONFIRMATIONS,
    allowMempool: false,
    allowMissingHealthPolicy: false,
  };
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
      continue;
    }
    if (arg === '--min-confirmations') {
      out.minConfirmations = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--min-confirmations=')) {
      out.minConfirmations = Number(arg.slice('--min-confirmations='.length));
      continue;
    }
    if (arg === '--allow-mempool') {
      out.allowMempool = true;
      continue;
    }
    if (arg === '--allow-missing-health-policy') {
      out.allowMissingHealthPolicy = true;
    }
  }
  if (!Number.isInteger(out.minConfirmations) || out.minConfirmations < 1) {
    throw new Error('--min-confirmations must be a positive integer');
  }
  return out;
}

function validateHealthPolicy(body, args) {
  const policy = body?.policy;
  const confirmation = policy?.confirmation;
  if (!confirmation) {
    return args.allowMissingHealthPolicy
      ? undefined
      : {
          reason: 'missing_confirmation_policy',
          message: '/health must expose policy.confirmation for production readiness monitoring',
        };
  }
  if (!args.allowMempool && confirmation.confirmationMode === 'allow_mempool') {
    return {
      reason: 'mempool_mode_enabled',
      message: 'Production monitor expects confirmationMode=confirmed_only',
    };
  }
  if (confirmation.requireNonce !== true) {
    return {
      reason: 'nonce_not_required',
      message: 'Production monitor expects requireNonce=true',
    };
  }
  if (
    !Number.isInteger(confirmation.minConfirmations) ||
    confirmation.minConfirmations < args.minConfirmations
  ) {
    return {
      reason: 'min_confirmations_too_low',
      message: `Production monitor expects minConfirmations >= ${args.minConfirmations}`,
    };
  }
  const signer = policy?.signer;
  if (!signer) {
    return {
      reason: 'missing_signer_policy',
      message: '/health must expose policy.signer for signer posture monitoring',
    };
  }
  if (signer.mode !== 'local-file') {
    return {
      reason: 'unexpected_signer_mode',
      message: 'Production monitor only recognises signer mode local-file until remote policy signing is implemented',
    };
  }
  if (signer.hotWallet !== true) {
    return {
      reason: 'unexpected_signer_hot_wallet_flag',
      message: 'Production monitor expects local-file signer mode to report hotWallet=true',
    };
  }
  return undefined;
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

async function checkEndpoint(baseUrl, endpoint, args) {
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
  let parsedJson;
  if (endpoint.expectJson && !challenged) {
    try {
      parsedJson = JSON.parse(text);
    } catch {
      jsonOk = false;
    }
  }
  const validationFailure =
    jsonOk && parsedJson !== undefined && endpoint.validate
      ? endpoint.validate(parsedJson, args)
      : undefined;

  const statusOk =
    endpoint.path === '/verify' || endpoint.path === '/settle'
      ? response.status === 200 || response.status === 400
      : response.status >= 200 && response.status < 300;
  const ok = statusOk && jsonOk && !challenged && validationFailure === undefined;

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
          : validationFailure?.reason,
    message: validationFailure?.message,
    contentType: response.headers.get('content-type'),
    cfMitigated: response.headers.get('cf-mitigated'),
    durationMs: Date.now() - started,
  };
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const checks = await Promise.all(
  MACHINE_ENDPOINTS.map((endpoint) => checkEndpoint(args.baseUrl, endpoint, args))
);
const ok = checks.every((check) => check.ok);
const result = {
  ok,
  baseUrl: args.baseUrl,
  checkedAt: new Date().toISOString(),
  expectedPolicy: {
    minConfirmations: args.minConfirmations,
    allowMempool: args.allowMempool,
    allowMissingHealthPolicy: args.allowMissingHealthPolicy,
  },
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
