#!/usr/bin/env node
// Read-only post-deploy check of the static website. GET/HEAD only: it never
// sends a payment, body or credential. Compares the deployed files byte for
// byte with website-dist/ (run `pnpm build:website` from the same commit
// first) and confirms that retired API and discovery paths are 404s.
// Usage: node scripts/smoke-website.mjs <base-url>   Exit 0 = all checks passed.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2];
if (!base) {
  console.log('error: base URL is required');
  console.log('help: node scripts/smoke-website.mjs https://cardano402.com');
  process.exit(2);
}
const site = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'website-dist');
const failures = [];
const get = (path, method = 'GET') =>
  fetch(new URL(path, base), { method, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
const sha256 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

async function check(name, fn) {
  try {
    console.log(`ok: ${name}${(await fn()) ?? ''}`);
  } catch (error) {
    failures.push(name);
    console.log(`fail: ${name}: ${error instanceof Error ? error.message : error}`);
  }
}
function expectStatus(res, status) {
  // A Cloudflare challenge is never a pass: the visitor did not get the site.
  if (res.headers.get('cf-mitigated'))
    throw new Error(
      `Cloudflare ${res.headers.get('cf-mitigated')} (HTTP ${res.status}); verify from a browser`
    );
  if (res.status !== status) throw new Error(`HTTP ${res.status}, expected ${status}`);
}

for (const [path, file] of [
  ['/', 'index.html'],
  ['/dist/app.js', 'dist/app.js'],
  ['/llms.txt', 'llms.txt'],
  ['/SKILL.md', 'SKILL.md'],
]) {
  await check(`${path} matches website-dist/${file}`, async () => {
    const res = await get(path);
    expectStatus(res, 200);
    const [live, built] = [await res.text(), await readFile(resolve(site, file), 'utf8')];
    if (live !== built)
      throw new Error(`bytes differ (live ${sha256(live)}, built ${sha256(built)})`);
    return ` (sha256 ${sha256(live)})`;
  });
}
await check('/info redirects to /llms.txt', async () => {
  const res = await get('/info');
  if (![301, 302, 307, 308].includes(res.status)) throw new Error(`HTTP ${res.status}`);
  if (new URL(res.headers.get('location'), base).pathname !== '/llms.txt')
    throw new Error('wrong location');
});
const notFound = await readFile(resolve(site, '404.html'), 'utf8');
for (const path of [
  '/supported',
  '/verify',
  '/settle',
  '/health',
  '/.well-known/x402.json',
  '/demo/run',
]) {
  await check(`${path} is a retired 404`, async () => {
    const res = await get(path);
    expectStatus(res, 404);
    if ((await res.text()) !== notFound) throw new Error('not the static 404 page');
  });
}

console.log(
  failures.length ? `smoke-website: ${failures.length} failed` : 'smoke-website: all checks passed'
);
process.exit(failures.length ? 1 : 0);
