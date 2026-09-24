#!/usr/bin/env node
// Post-deploy smoke check against a live facilitator. Read-only: it never
// submits a payment. Usage: node scripts/smoke.mjs <base-url> <expected-network>
// Exit 0 = healthy, 1 = a check failed, 2 = usage error.

const [base, network] = process.argv.slice(2);
if (!base || !network) {
  console.log('error: base URL and expected network are required');
  console.log('help: node scripts/smoke.mjs https://cardano402.com cardano:mainnet');
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

await check('home view is TOON for agents', async () => {
  const text = await (await get('/')).text();
  assert(text.startsWith('service: cardano402'), 'unexpected home view');
  assert(text.includes(network), `home view does not name ${network}`);
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
  assert(res.status === 400, `status ${res.status}`);
});
await check('/health?deep=1 reaches the chain provider', async () => {
  const res = await get('/health?deep=1');
  const body = await res.json();
  assert(res.status === 200 && body.provider === 'up', `status ${res.status}, provider ${body.provider}`);
  assert(body.network === network, `network ${body.network}`);
});

console.log(failures.length ? `smoke: ${failures.length} failed` : 'smoke: all checks passed');
process.exit(failures.length ? 1 : 0);
