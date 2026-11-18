#!/usr/bin/env node
// Offline routing check for the static website (wrangler.website.jsonc).
// Runs that config and the built website-dist/ assets, _headers and
// _redirects through Wrangler's local dev engine, which uses Cloudflare's
// asset router. A local stub stands in for the old tunnel origin and must
// never be reached. Nothing leaves this machine; no credentials are used.
// Run after `pnpm build:website`. Exit 0 = every fixture case matched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WRANGLER_SEND_METRICS = 'false';
const { unstable_startWorker, unstable_readConfig } = await import('wrangler');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, 'website-dist');
const configPath = resolve(root, 'wrangler.website.jsonc');
const { cases } = JSON.parse(
  await readFile(resolve(root, 'test/fixtures/website-routes.json'), 'utf8')
);

// The deployable configuration itself, for production and staging.
for (const env of [undefined, 'staging']) {
  const config = unstable_readConfig({ config: configPath, env });
  const label = env ?? 'production';
  assert.equal(config.main, undefined, `${label}: no Worker script; assets only`);
  assert.equal(
    config.assets?.not_found_handling,
    '404-page',
    `${label}: unmatched paths get the 404 page, not the SPA`
  );
  assert.notEqual(config.assets?.run_worker_first, true, `${label}: no Worker-first routing`);
  for (const key of [
    'services',
    'durable_objects',
    'kv_namespaces',
    'r2_buckets',
    'd1_databases',
    'ratelimits',
  ]) {
    const value = config[key];
    assert(
      !value || (Array.isArray(value) ? value.length === 0 : (value.bindings ?? []).length === 0),
      `${label}: unexpected ${key}`
    );
  }
  assert.deepEqual(Object.keys(config.vars ?? {}), [], `${label}: no vars`);
  assert(
    !(config.routes ?? []).some((route) => route.custom_domain),
    `${label}: Routes, not Custom Domains, at this stage`
  );
}

// Stand-in for the old tunnel origin. Any request reaching it is a failure.
const originRequests = [];
const origin = createServer((req, res) => {
  originRequests.push(`${req.method} ${req.url}`);
  res.setHeader('x-fixture-origin', '1');
  res.end('origin');
});
await new Promise((ready) => origin.listen(0, '127.0.0.1', ready));

const worker = await unstable_startWorker({
  config: configPath,
  dev: {
    server: { hostname: '127.0.0.1', port: 0 },
    origin: { hostname: `127.0.0.1:${origin.address().port}`, secure: false },
    inspector: false,
    watch: false,
    remote: false,
    logLevel: 'error',
  },
});

const headersFile = await readFile(resolve(site, '_headers'), 'utf8');
const csp = headersFile.match(/Content-Security-Policy: (.+)/)[1];
const notFoundPage = await readFile(resolve(site, '404.html'), 'utf8');
const landing = await readFile(resolve(site, 'index.html'), 'utf8');

const failures = [];
try {
  await worker.ready;
  const base = await worker.url;
  for (const c of cases) {
    const label = `${c.method} ${c.path}${c.headers?.['sec-fetch-mode'] ? ' (navigate)' : ''}`;
    const before = originRequests.length;
    try {
      const res = await worker.fetch(new URL(c.path, base), {
        method: c.method,
        body: ['GET', 'HEAD'].includes(c.method) ? undefined : '{"x402Version":2,"fixture":true}',
        redirect: 'manual',
        headers: { 'content-type': 'application/json', ...c.headers },
      });
      const text = await res.text();
      assert.equal(originRequests.length, before, 'request reached the origin');
      assert.equal(res.headers.get('x-fixture-origin'), null, 'answered by the origin');
      if (c.expect === 'asset') {
        assert.equal(res.status, 200, `status ${res.status}`);
        assert.equal(res.headers.get('content-security-policy'), csp, 'site headers missing');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        if (c.method === 'GET')
          assert.equal(text, await readFile(resolve(site, c.file), 'utf8'), 'asset bytes differ');
      } else if (c.expect === 'redirect') {
        assert([301, 302, 307, 308].includes(res.status), `status ${res.status}`);
        assert.equal(new URL(res.headers.get('location'), base).pathname, c.location);
      } else if (c.expect === 'not-found') {
        assert.equal(res.status, 404, `status ${res.status}`);
        assert.equal(res.headers.get('content-security-policy'), csp, 'site headers missing');
        if (c.method === 'GET') {
          assert.equal(text, notFoundPage, 'not the static 404 page');
          assert.notEqual(text, landing);
        }
      } else if (c.expect === 'method-not-allowed') {
        assert.equal(res.status, 405, `status ${res.status}`);
        assert.notEqual(text, landing, 'answered with the landing page');
      } else {
        throw new Error(`unknown expectation ${c.expect}`);
      }
      console.log(`ok: ${label} -> ${c.expect} (${res.status})`);
    } catch (error) {
      failures.push(label);
      console.log(
        `fail: ${label} -> ${c.expect}: ${error instanceof Error ? error.message : error}`
      );
    }
  }
} finally {
  await worker.dispose();
  origin.close();
}

console.log(
  failures.length
    ? `website routing: ${failures.length} failed`
    : `website routing: all ${cases.length} cases passed`
);
process.exit(failures.length ? 1 : 0);
