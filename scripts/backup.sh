#!/usr/bin/env bash
# cardano402 backup — nightly snapshot of sensitive config, Redis AOF,
# and uploaded payment-gated files. Encrypted off-host via restic.
#
# Usage: bash scripts/backup.sh
# Cron:  see scripts/cardano402-backup.cron
#
# Credentials and backend choice live in /etc/cardano402/restic.env
# (mode 0600, root-owned). See scripts/cardano402-restic.env.example.

set -euo pipefail

REPO_ROOT="${CARDANO402_REPO_ROOT:-/opt/cardano402}"
ENV_FILE="${CARDANO402_RESTIC_ENV:-/etc/cardano402/restic.env}"
LOG_FILE="${CARDANO402_BACKUP_LOG:-/var/log/cardano402-backup.log}"
LOCK_FILE="${CARDANO402_BACKUP_LOCK:-/var/run/cardano402-backup.lock}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" \
    | tee -a "$LOG_FILE"
}

STAGE_DIR=""
cleanup() {
  local rc=$?
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
  rm -f "$LOCK_FILE"
  if [ "$rc" -ne 0 ]; then
    log "=== cardano402 backup FAILED (exit $rc) ==="
  fi
  exit "$rc"
}
trap cleanup EXIT

# Prevent overlapping runs.
if [ -f "$LOCK_FILE" ]; then
  existing_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    log "FATAL: backup already running (pid $existing_pid). Aborting."
    exit 1
  fi
  log "Stale lock at $LOCK_FILE (no live pid), reclaiming"
fi
echo $$ > "$LOCK_FILE"

log "=== cardano402 backup starting ==="

if [ ! -r "$ENV_FILE" ]; then
  log "FATAL: $ENV_FILE missing or unreadable."
  log "  Copy scripts/cardano402-restic.env.example to $ENV_FILE, fill it in,"
  log "  chown root:root, chmod 600."
  exit 1
fi
# shellcheck disable=SC1090
. "$ENV_FILE"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY not set in $ENV_FILE}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD not set in $ENV_FILE}"
export RESTIC_REPOSITORY RESTIC_PASSWORD
# Pass-through any backend env vars that the env file may have exported.
[ -n "${B2_ACCOUNT_ID:-}" ] && export B2_ACCOUNT_ID B2_ACCOUNT_KEY
[ -n "${AWS_ACCESS_KEY_ID:-}" ] && export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

if ! command -v restic >/dev/null 2>&1; then
  log "FATAL: restic not installed. Install with: apt install restic"
  exit 1
fi

STAGE_DIR=$(mktemp -d /tmp/cardano402-backup-XXXXXX)
chmod 700 "$STAGE_DIR"
log "Staging to $STAGE_DIR"

# 1. Sensitive config (the most valuable target — seed phrase + Blockfrost key).
mkdir -p "$STAGE_DIR/sensitive"
cp -p "$REPO_ROOT/config/config.json" "$STAGE_DIR/sensitive/config.json"
cp -p "$REPO_ROOT/.env"               "$STAGE_DIR/sensitive/dotenv"
log "Staged: sensitive config ($(du -sh "$STAGE_DIR/sensitive" | cut -f1))"

# 1b. Shared VPS infrastructure: the Cloudflare tunnel config + its credential
#     (root-only 0400 file — readable here because this job runs as root) and the
#     three /etc/cron.d backup schedules. Lets a fresh box restore public ingress
#     for all three sites (cardano402.com, thehosksaid.com, tubechat.video) without
#     re-creating the shared tunnel. Tiny; restic dedups.
mkdir -p "$STAGE_DIR/infra"
[ -d /etc/cloudflared ] && cp -a /etc/cloudflared "$STAGE_DIR/infra/cloudflared"
for c in /etc/cron.d/cardano402-backup /etc/cron.d/tubechat-backup /etc/cron.d/hosksaid-backup; do
  [ -f "$c" ] && cp -p "$c" "$STAGE_DIR/infra/"
done
log "Staged: infra ($(du -sh "$STAGE_DIR/infra" 2>/dev/null | cut -f1))"

# 2. Redis AOF volume. AOF is append-only; copying the on-disk state while
#    redis is running yields a valid replica that may be slightly behind
#    the in-memory state. Restic deduplicates so growing AOFs are cheap.
log "Snapshotting Redis volume"
docker run --rm \
  -v cardano402_redis_data:/source:ro \
  -v "$STAGE_DIR/redis":/dest \
  alpine sh -c "cp -a /source/. /dest/" \
  >> "$LOG_FILE" 2>&1
log "Staged: redis ($(du -sh "$STAGE_DIR/redis" 2>/dev/null | cut -f1))"

# 3. Uploaded payment-gated files (the storage backend's filesystem root).
if [ -d "$REPO_ROOT/data/files" ]; then
  cp -a "$REPO_ROOT/data/files" "$STAGE_DIR/data-files"
  log "Staged: data-files ($(du -sh "$STAGE_DIR/data-files" | cut -f1))"
else
  log "Skipped: $REPO_ROOT/data/files does not exist yet"
fi

# 4. Manifest with metadata for forensic traceability.
container_image=$(docker inspect cardano402 --format '{{.Image}}' 2>/dev/null || echo "container-not-running")
git_sha=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
cat > "$STAGE_DIR/MANIFEST.txt" <<EOF
cardano402 backup manifest
host:            $(hostname)
date_utc:        $(date -u +%Y-%m-%dT%H:%M:%SZ)
git_sha:         $git_sha
container_image: $container_image
EOF

# 5. Run restic backup. Tags make `restic forget --tag automated` safe.
log "Running restic backup"
restic backup \
  --tag automated \
  --tag cardano402 \
  --host "$(hostname)" \
  "$STAGE_DIR" \
  | tee -a "$LOG_FILE"

# 6. Prune old snapshots per retention policy.
log "Pruning old snapshots (keep 14d / 8w / 12m)"
restic forget \
  --tag automated \
  --keep-daily 14 \
  --keep-weekly 8 \
  --keep-monthly 12 \
  --prune \
  | tee -a "$LOG_FILE"

# 7. Cheap integrity check on a 5% sample of pack files.
log "Verifying repo integrity (5% sample)"
restic check --read-data-subset=5% | tee -a "$LOG_FILE"

log "=== cardano402 backup completed successfully ==="
