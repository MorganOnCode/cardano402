# Backup & Restore Runbook

cardano402 stores three things on the VPS that aren't in git and aren't trivially reconstructible:

1. **`config/config.json`** — mainnet facilitator seed phrase + Blockfrost project ID. **Most valuable target.**
2. **`.env`** — `REDIS_PASSWORD` + `MAINNET` guardrail flag.
3. **Redis AOF volume (`cardano402_redis_data`)** — payment dedup keys and UTXO cache. Rebuildable from chain state but accelerates recovery.
4. **`data/files/`** — uploaded payment-gated content (per-tenant; can grow over time).

This runbook covers nightly encrypted backups, restore verification, and disaster recovery.

## Architecture

- **Tool:** [restic](https://restic.net/) — client-side AES-256 encryption, content-addressed dedup, single binary, supports many backends through one config.
- **Backend:** swappable via env file. Default documentation uses Backblaze B2 (cheapest for tiny repos); the example file also shows Cloudflare R2, AWS S3, Hetzner Storage Box, and tailnet SFTP.
- **Schedule:** nightly at 03:00 UTC via `/etc/cron.d/cardano402-backup`.
- **Retention:** 14 daily snapshots, 8 weekly, 12 monthly (~24 snapshots steady-state).
- **Integrity:** every run does a `restic check --read-data-subset=5%`.
- **Verification:** documented restore-to-temp procedure, recommended quarterly.

## One-time setup

### 1. Pick and configure a backend

Sign up for whichever backend you want (see `scripts/cardano402-restic.env.example` for B2 / R2 / S3 / Hetzner / SFTP). For B2 (the recommended default):

1. Create account at https://www.backblaze.com/sign-up/cloud-storage
2. Create a private bucket named `cardano402-backups`
3. Generate an Application Key scoped to that bucket with read+write access
4. Save the keyID and applicationKey — they're shown only once

### 2. Generate the encryption passphrase

This passphrase decrypts the entire repository. Without it, the backups are unreadable, including by you.

```bash
openssl rand -base64 36
```

**Store this passphrase in at least two durable, offline locations** before the first backup runs:

- Paper copy in a fireproof safe / safety deposit box
- Password manager you control (1Password, Bitwarden, etc.)
- Optional: a YubiKey-encrypted file
- Optional: secret-sharing across trusted parties (Shamir, with thresholds)

If you only have the passphrase on this VPS, a VPS failure means losing both the data and the backups of the data.

### 3. Install restic and the credentials file

On the VPS (via Tailscale SSH):

```bash
sudo apt update && sudo apt install -y restic

sudo mkdir -p /etc/cardano402
sudo cp /opt/cardano402/scripts/cardano402-restic.env.example /etc/cardano402/restic.env
sudo chown root:root /etc/cardano402/restic.env
sudo chmod 600 /etc/cardano402/restic.env

sudo nano /etc/cardano402/restic.env   # fill in RESTIC_PASSWORD + backend creds
```

### 4. Initialize the restic repository

This creates the encryption keys in the remote bucket. Only run once.

```bash
sudo -E env $(grep -v '^#' /etc/cardano402/restic.env | xargs) restic init
```

(The `sudo -E env ...` dance loads the env file into restic's environment for this one command.)

### 5. Run an initial backup

```bash
sudo bash /opt/cardano402/scripts/backup.sh
```

Watch the log:

```bash
sudo tail -f /var/log/cardano402-backup.log
```

Expected: completes in seconds for a fresh facilitator (~30KB total). Restic outputs the snapshot ID at the end (`snapshot abc12345 saved`).

### 6. Verify the restore loop works

This is the most important post-setup step. **A backup you've never restored is not a backup.**

```bash
sudo bash /opt/cardano402/scripts/restore.sh latest /tmp/restore-test
```

Inspect:

```bash
sudo ls -la /tmp/restore-test
sudo cat /tmp/restore-test/.../MANIFEST.txt
sudo diff /opt/cardano402/config/config.json /tmp/restore-test/.../sensitive/config.json
# Should be identical.

sudo rm -rf /tmp/restore-test
```

The restore script forces the target directory to `0700` because restored
snapshots contain `config.json`, `.env`, and payment-gated content. Keep that
directory private until you delete it.

### 7. Enable the cron job

```bash
sudo cp /opt/cardano402/scripts/cardano402-backup.cron /etc/cron.d/cardano402-backup
sudo chmod 644 /etc/cron.d/cardano402-backup
```

Confirm cron will pick it up:

```bash
sudo grep cardano402 /etc/cron.d/cardano402-backup
sudo systemctl status cron
```

The next scheduled run is 03:00 UTC.

## Routine operations

### Check recent runs

```bash
sudo tail -100 /var/log/cardano402-backup.log
```

Look for `=== cardano402 backup completed successfully ===` lines.

### List snapshots

```bash
sudo bash /opt/cardano402/scripts/restore.sh list
```

### Run a backup on demand

```bash
sudo bash /opt/cardano402/scripts/backup.sh
```

### Run a periodic restore test (recommended quarterly)

```bash
sudo bash /opt/cardano402/scripts/restore.sh latest /tmp/restore-q$(date +%Y%m%d)
# Inspect a few files, confirm MANIFEST.txt looks right, then:
sudo rm -rf /tmp/restore-q*
```

Calendar reminder: every 90 days. A backup chain that hasn't been tested in a year tends to silently break.

## Disaster recovery scenarios

### Scenario A — `config/config.json` got corrupted/deleted on the live VPS

```bash
sudo bash /opt/cardano402/scripts/restore.sh latest /tmp/recover
sudo cp /tmp/recover/.../sensitive/config.json /opt/cardano402/config/config.json
sudo chown morganic:morganic /opt/cardano402/config/config.json
sudo chmod 644 /opt/cardano402/config/config.json
docker compose -f /opt/cardano402/docker-compose.prod.yml restart facilitator
curl http://localhost:3000/health
```

### Scenario B — VPS disk failure, new VPS available

1. Provision the new VPS, attach to Tailscale, install Docker.
2. Clone the repo: `sudo git clone https://github.com/MorganOnCode/cardano402 /opt/cardano402`
3. Install restic, copy the **same** `/etc/cardano402/restic.env` (you have an offline copy of the passphrase).
4. Restore: `sudo bash /opt/cardano402/scripts/restore.sh latest /tmp/recover`
5. Put files back:
   ```bash
   sudo cp /tmp/recover/.../sensitive/config.json /opt/cardano402/config/config.json
   sudo cp /tmp/recover/.../sensitive/dotenv      /opt/cardano402/.env
   sudo mkdir -p /opt/cardano402/data
   sudo cp -a /tmp/recover/.../data-files /opt/cardano402/data/files
   ```
6. Restore Redis volume:
   ```bash
   docker volume create cardano402_redis_data
   docker run --rm \
     -v cardano402_redis_data:/dest \
     -v /tmp/recover/.../redis:/source:ro \
     alpine sh -c "cp -a /source/. /dest/"
   ```
7. Start: `cd /opt/cardano402 && docker compose -f docker-compose.prod.yml up -d`
8. Verify: `curl http://localhost:3000/health` returns `healthy`.

### Scenario C — VPS is gone AND the passphrase is gone

You're in trouble. The mainnet seed phrase is no longer recoverable from any encrypted backup — only from whatever offline seed-phrase backup you kept at the moment you set up the facilitator (per Cardano custody best practice, the 24-word phrase should already be written down somewhere safe, completely independent of this backup chain). Re-import the seed into a fresh facilitator install and recover funds. Uploaded payment-gated content is lost.

This is the scenario the offline passphrase storage in step 2 of setup is designed to prevent.

## Failure modes & alerts

The backup script writes to syslog and `/var/log/cardano402-backup.log`. To get notified of failures, the simplest option is a Sentry integration: wrap the cron entry in `curl --data-raw "..." https://<sentry-cron-monitor-url>` before and after. Defer until repeat failures actually happen — `restic check` failures are rare and `restic backup` failures are usually self-explanatory in the log.

If you want to get fancier: `cronitor.io`, `healthchecks.io`, or a dead-man's-switch via Pingdom.

## What's NOT backed up (by design)

- **Docker images** — rebuildable from `docker compose build` against the same git commit
- **`node_modules`** — pnpm install reproduces this from `pnpm-lock.yaml` in git
- **Application logs** — handled by Docker's log rotation (json-file driver, max-size 50m, max-file 5)
- **The git working tree** — already redundantly stored on GitHub

If the VPS dies and the backups die *and* the GitHub repo dies, that's a three-way disaster the runbook doesn't cover.
