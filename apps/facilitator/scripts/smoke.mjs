#!/usr/bin/env node
// Post-deploy smoke check against a live facilitator. Read-only: it never
// submits a payment. Usage: node scripts/smoke.mjs <base-url> <expected-network>
// Exit 0 = healthy, 1 = a check failed, 2 = usage error.

const [base, network] = process.argv.slice(2);
if (!base || !network) {
  console.log('error: base URL and expected network are required');
  console.log('help: node scripts/smoke.mjs https://cardano402.com cardano:preview');
  process.exit(2);
}

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok: ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`fail: ${name}: ${error instanceof Error ? error.message : error}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const get = (path, headers = {}) => fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(15_000) });

await check('portfolio is static HTML', async () => {
  const res = await get('/');
  assert(res.ok && res.headers.get('content-type')?.includes('text/html'), 'portfolio unavailable');
  assert((await res.text()).includes('/dist/app.js'), 'original landing bundle missing');
});
await check('agent view is available', async () => {
  const text = await (await get('/info')).text();
  assert(text.startsWith('service: cardano402') && text.includes(network), 'unexpected agent view');
});
await check('/supported advertises exact on the expected network, keyless', async () => {
  const body = await (await get('/supported')).json();
  assert(body.kinds?.some((k) => k.x402Version === 2 && k.scheme === 'exact' && k.network === network), 'kind missing');
  assert(Object.values(body.signers ?? {}).flat().length === 0, 'facilitator advertises a signer key');
});
await check('/verify rejects an empty body with 400', async () => {
  const res = await fetch(new URL('/verify', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 2 }),
  });
  assert([400, 503].includes(res.status), `status ${res.status}`);
});
await check('shallow health requires no provider request', async () => {
  const res = await get('/health');
  const body = await res.json();
  assert(res.ok && body.network === network, 'unexpected health');
});

console.log(failures.length ? `smoke: ${failures.length} failed` : 'smoke: all checks passed');
process.exit(failures.length ? 1 : 0);
