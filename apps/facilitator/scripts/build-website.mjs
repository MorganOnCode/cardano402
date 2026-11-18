#!/usr/bin/env node
// Assemble the static cardano402.com website: the original landing build
// (public/) plus the website-only static docs and 404 page (site/), into
// website-dist/. There is no Worker script: Cloudflare serves these files
// directly, so no request can reach a facilitator, demo or the VPS origin.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'website-dist');

execFileSync(process.execPath, [resolve(root, 'scripts/build-landing.mjs')], { stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
cpSync(resolve(root, 'public'), out, { recursive: true });
for (const name of ['404.html', 'llms.txt', 'SKILL.md', 'robots.txt', '_redirects']) {
  const target = resolve(out, name);
  if (existsSync(target)) throw new Error(`site/${name} would overwrite a landing file`);
  cpSync(resolve(root, 'site', name), target);
}
console.log('Website: website-dist/ assembled (static assets only).');
