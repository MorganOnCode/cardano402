/**
 * Regression tests for signer coverage in scripts/backup.sh.
 *
 * The nightly snapshot used to stage config.json (which only holds *paths* to
 * the signing files) while never staging the signing files themselves, so a
 * snapshot could look complete and still be unable to rebuild a signing
 * facilitator. These tests drive the real script against a synthetic fixture
 * tree with stubbed `docker` and `restic` binaries, and assert on the staged
 * tree the stub records.
 *
 * Everything here is synthetic: fake seed markers, a placeholder restic env,
 * and stub binaries. Nothing touches a real repository, volume or credential.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const BACKUP_SH = fileURLToPath(new URL('../../scripts/backup.sh', import.meta.url));

const FACILITATOR_SEED = 'SYNTHETIC-FACILITATOR-SEED-MARKER not a real mnemonic\n';
const DEMO_SEED = 'SYNTHETIC-DEMO-SEED-MARKER not a real mnemonic\n';
const UNREFERENCED_SECRET = 'SYNTHETIC-UNREFERENCED-MARKER not named by config.json\n';

/** One staged file as recorded by the restic stub. */
interface StagedFile {
  path: string;
  mode: string;
  size: number;
  sha256: string;
}

const RESTIC_STUB = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "backup" ]; then
  stage=""
  for a in "$@"; do stage="$a"; done
  : > "$RESTIC_STUB_INVENTORY"
  while IFS= read -r rel; do
    printf '%s\\t%s\\t%s\\t%s\\n' \\
      "$rel" \\
      "$(stat -c '%a' "$stage/$rel")" \\
      "$(stat -c '%s' "$stage/$rel")" \\
      "$(sha256sum "$stage/$rel" | cut -d' ' -f1)" >> "$RESTIC_STUB_INVENTORY"
  done < <(cd "$stage" && find . -type f -printf '%P\\n' | sort)
  echo "snapshot stub0001 saved"
  exit 0
fi
echo "restic stub invoked: $*"
exit 0
`;

const DOCKER_STUB = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "inspect" ]; then
  echo "sha256:stubimageid"
  exit 0
fi
if [ "\${1:-}" = "run" ]; then
  dest=""
  prev=""
  for a in "$@"; do
    if [ "$prev" = "-v" ]; then
      case "$a" in *:/dest) dest="\${a%:/dest}" ;; esac
    fi
    prev="$a"
  done
  if [ -n "$dest" ]; then
    mkdir -p "$dest"
    printf 'stub-aof-bytes' > "$dest/appendonly.aof"
  fi
  exit 0
fi
exit 0
`;

describe('scripts/backup.sh signer staging', () => {
  let root: string;
  let repo: string;
  let inventoryPath: string;
  let logPath: string;

  /** Build the synthetic tree. `config` is written verbatim as config.json. */
  function fixture(config: Record<string, unknown>): void {
    mkdirSync(join(repo, 'config'), { recursive: true });
    writeFileSync(join(repo, 'config', 'config.json'), JSON.stringify(config, null, 2));
    writeFileSync(join(repo, '.env'), 'REDIS_PASSWORD=fixture-value\nMAINNET=false\n');

    mkdirSync(join(repo, 'secrets'), { recursive: true });
    writeFileSync(join(repo, 'secrets', 'facilitator.seed'), FACILITATOR_SEED, { mode: 0o600 });
    writeFileSync(join(repo, 'secrets', 'demo.seed'), DEMO_SEED, { mode: 0o600 });
    // Present on disk but NOT named by config.json — must never be staged.
    writeFileSync(join(repo, 'secrets', 'unreferenced.key'), UNREFERENCED_SECRET, { mode: 0o600 });
    chmodSync(join(repo, 'secrets', 'facilitator.seed'), 0o600);
    chmodSync(join(repo, 'secrets', 'demo.seed'), 0o600);

    mkdirSync(join(repo, 'data', 'files'), { recursive: true });
    writeFileSync(join(repo, 'data', 'files', 'gated.txt'), 'payment gated fixture\n');

    // A node_modules tree next to the repo root proves the script copies by
    // explicit path rather than sweeping the checkout.
    mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');

    mkdirSync(join(root, 'infra', 'cloudflared'), { recursive: true });
    writeFileSync(join(root, 'infra', 'cloudflared', 'config.yml'), 'tunnel: fixture\n');
    mkdirSync(join(root, 'cron.d'), { recursive: true });
    writeFileSync(join(root, 'cron.d', 'cardano402-backup'), '# fixture cron\n');

    writeFileSync(
      join(root, 'restic.env'),
      ['RESTIC_REPOSITORY="local:/fixture/not-a-real-repository"', 'RESTIC_PASSWORD="fixture-placeholder-not-a-passphrase"', ''].join('\n'),
      { mode: 0o600 },
    );
  }

  function signerConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      env: 'production',
      chain: {
        network: 'Preview',
        facilitator: {
          signerMode: 'local-file',
          seedPhraseFile: '/run/secrets/facilitator.seed',
        },
      },
      demo: {
        seedPhraseFile: '/run/secrets/demo.seed',
        network: 'Preview',
      },
      ...overrides,
    };
  }

  function runBackup(): { status: number | null; stdout: string; stderr: string; log: string } {
    const binDir = join(root, 'bin');
    const result = spawnSync('bash', [BACKUP_SH], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        CARDANO402_REPO_ROOT: repo,
        CARDANO402_RESTIC_ENV: join(root, 'restic.env'),
        CARDANO402_BACKUP_LOG: logPath,
        CARDANO402_BACKUP_LOCK: join(root, 'backup.lock'),
        CARDANO402_CLOUDFLARED_DIR: join(root, 'infra', 'cloudflared'),
        CARDANO402_CRON_DIR: join(root, 'cron.d'),
        RESTIC_STUB_INVENTORY: inventoryPath,
      },
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      log: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '',
    };
  }

  function stagedFiles(): StagedFile[] {
    if (!existsSync(inventoryPath)) return [];
    return readFileSync(inventoryPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [path, mode, size, sha256] = line.split('\t');
        return { path, mode, size: Number(size), sha256 };
      });
  }

  function sha256Of(file: string): string {
    const out = spawnSync('sha256sum', [file], { encoding: 'utf8' });
    return (out.stdout ?? '').split(' ')[0];
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'c402-backup-test-'));
    repo = join(root, 'repo');
    inventoryPath = join(root, 'inventory.tsv');
    logPath = join(root, 'backup.log');

    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'restic'), RESTIC_STUB, { mode: 0o755 });
    writeFileSync(join(binDir, 'docker'), DOCKER_STUB, { mode: 0o755 });
    chmodSync(join(binDir, 'restic'), 0o755);
    chmodSync(join(binDir, 'docker'), 0o755);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stages every signing file config.json names', () => {
    fixture(signerConfig());
    const run = runBackup();

    expect(run.status).toBe(0);
    const staged = stagedFiles().map((f) => f.path);
    expect(staged).toContain('sensitive/secrets/facilitator.seed');
    expect(staged).toContain('sensitive/secrets/demo.seed');
  });

  it('preserves signer bytes and 0600 mode through staging', () => {
    fixture(signerConfig());
    const run = runBackup();
    expect(run.status).toBe(0);

    const staged = stagedFiles();
    const facilitator = staged.find((f) => f.path === 'sensitive/secrets/facilitator.seed');
    const demo = staged.find((f) => f.path === 'sensitive/secrets/demo.seed');

    expect(facilitator).toBeDefined();
    expect(demo).toBeDefined();
    expect(facilitator?.sha256).toBe(sha256Of(join(repo, 'secrets', 'facilitator.seed')));
    expect(demo?.sha256).toBe(sha256Of(join(repo, 'secrets', 'demo.seed')));
    expect(facilitator?.size).toBe(Buffer.byteLength(FACILITATOR_SEED));
    expect(facilitator?.mode).toBe('600');
    expect(demo?.mode).toBe('600');
  });

  it('resolves privateKeyFile and host-absolute signer paths too', () => {
    fixture(
      signerConfig({
        chain: {
          network: 'Preview',
          facilitator: {
            signerMode: 'local-file',
            privateKeyFile: join(repo, 'secrets', 'facilitator.seed'),
          },
        },
        demo: { seedPhraseFile: 'secrets/demo.seed', network: 'Preview' },
      }),
    );
    const run = runBackup();

    expect(run.status).toBe(0);
    const staged = stagedFiles().map((f) => f.path);
    expect(staged).toContain('sensitive/secrets/facilitator.seed');
    expect(staged).toContain('sensitive/secrets/demo.seed');
  });

  it('fails the whole run when a configured signer file is missing', () => {
    fixture(signerConfig());
    rmSync(join(repo, 'secrets', 'facilitator.seed'));

    const run = runBackup();

    expect(run.status).not.toBe(0);
    expect(run.log).toMatch(/FATAL: chain\.facilitator\.seedPhraseFile/);
    expect(run.log).toMatch(/backup FAILED/);
    // The critical property: restic was never asked to snapshot a partial tree.
    expect(existsSync(inventoryPath)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('fails the whole run when a configured signer file is unreadable', () => {
    fixture(signerConfig());
    chmodSync(join(repo, 'secrets', 'demo.seed'), 0o000);

    const run = runBackup();

    expect(run.status).not.toBe(0);
    expect(run.log).toMatch(/FATAL: demo\.seedPhraseFile/);
    expect(existsSync(inventoryPath)).toBe(false);

    chmodSync(join(repo, 'secrets', 'demo.seed'), 0o600);
  });

  it('skips signer staging without failing when config.json names no signing file', () => {
    fixture(
      signerConfig({
        env: 'development',
        chain: {
          network: 'Preview',
          facilitator: { signerMode: 'local-file', seedPhrase: 'inline dev phrase fixture' },
        },
        demo: { network: 'Preview' },
      }),
    );

    const run = runBackup();

    expect(run.status).toBe(0);
    expect(run.log).toMatch(/no signer files/);
    const staged = stagedFiles().map((f) => f.path);
    expect(staged.some((p) => p.startsWith('sensitive/secrets/'))).toBe(false);
    // The rest of the snapshot is unaffected.
    expect(staged).toContain('sensitive/config.json');
  });

  it('never writes a signer value to the log or to stdout', () => {
    fixture(signerConfig());
    const run = runBackup();

    expect(run.status).toBe(0);
    for (const marker of ['SYNTHETIC-FACILITATOR-SEED-MARKER', 'SYNTHETIC-DEMO-SEED-MARKER']) {
      expect(run.log).not.toContain(marker);
      expect(run.stdout).not.toContain(marker);
      expect(run.stderr).not.toContain(marker);
    }
    // Metadata is what gets logged instead.
    expect(run.log).toMatch(/Staged signer: chain\.facilitator\.seedPhraseFile -> sensitive\/secrets\/facilitator\.seed/);
    expect(run.log).toMatch(/mode 600/);
  });

  it('stages nothing beyond the named signer files, config, infra, redis and data-files', () => {
    fixture(signerConfig());
    const run = runBackup();
    expect(run.status).toBe(0);

    const staged = stagedFiles().map((f) => f.path);

    // A secret sitting in secrets/ that config.json does not name is not ours.
    expect(staged).not.toContain('sensitive/secrets/unreferenced.key');
    expect(staged.every((p) => !p.includes('node_modules'))).toBe(true);

    const allowedPrefixes = ['sensitive/', 'infra/', 'redis/', 'data-files/', 'MANIFEST.txt'];
    for (const p of staged) {
      expect(allowedPrefixes.some((prefix) => p === prefix || p.startsWith(prefix))).toBe(true);
    }
  });

  it('refuses two configured signer files that collide on basename', () => {
    fixture(
      signerConfig({
        demo: { seedPhraseFile: '/run/secrets/facilitator.seed', network: 'Preview' },
      }),
    );

    const run = runBackup();

    expect(run.status).not.toBe(0);
    expect(run.log).toMatch(/share the basename/);
    expect(existsSync(inventoryPath)).toBe(false);
  });
});
