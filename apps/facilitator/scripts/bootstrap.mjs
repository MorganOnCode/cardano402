// Run only from the deployment workflow. Create a private placeholder when the
// public service does not exist yet, so the demo can bind to it on first deploy.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const environment = process.argv[2];
if (!['preview', 'production'].includes(environment)) throw new Error('Expected preview or production');
const name = environment === 'preview' ? 'cardano402-preview' : 'cardano402';
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!account || !token) throw new Error('Cloudflare credentials are required');
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Cannot inspect existing Workers: HTTP ${response.status}`);
const body = await response.json();
if (!body.success || !Array.isArray(body.result)) throw new Error('Cannot inspect existing Workers');
if (body.result.some((script) => script.id === name)) {
  console.log(`${name} already exists; bootstrap skipped.`);
} else {
  const directory = await mkdtemp(join(tmpdir(), 'cardano402-bootstrap-'));
  try {
    await writeFile(join(directory, 'index.js'), 'export default { fetch() { return new Response("Deployment in progress", { status: 503 }); } };\n');
    await writeFile(join(directory, 'wrangler.json'), JSON.stringify({
      name, main: './index.js', compatibility_date: '2026-08-15',
      workers_dev: false, preview_urls: false,
    }));
    execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', join(directory, 'wrangler.json')], { stdio: 'inherit' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
