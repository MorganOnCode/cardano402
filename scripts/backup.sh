#!/usr/bin/env bash
# cardano402 backup — nightly snapshot of sensitive config, the local signing
# files it references, Redis AOF, and uploaded payment-gated files. Encrypted
# off-host via restic.
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
# Shared-infra sources, overridable so the regression tests can point them at a
# fixture tree instead of the real host paths.
CLOUDFLARED_DIR="${CARDANO402_CLOUDFLARED_DIR:-/etc/cloudflared}"
CRON_DIR="${CARDANO402_CRON_DIR:-/etc/cron.d}"

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

# config.json is JSON, and the signer paths must be read exactly (not grepped).
# python3 is present on every Debian/Ubuntu base image this deploys on.
if ! command -v python3 >/dev/null 2>&1; then
  log "FATAL: python3 not installed (needed to read signer paths from config.json)."
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

# 1a. Local signing material. config.json holds *paths*, not the seed itself, so
#     staging config.json alone produced snapshots that looked complete but could
#     not rebuild a signing facilitator. Copy exactly the files config.json names
#     — no more (an unreferenced file in secrets/ is not this install's key
#     material) and no less. A configured-but-unreadable signer aborts the run:
#     a snapshot that silently omits the signing identity is worse than none.
#
#     Production mounts ./secrets read-only at /run/secrets (docker-compose.prod.yml),
#     so a container path maps back onto $REPO_ROOT.
signer_host_path() {
  case "$1" in
    /run/secrets/*) printf '%s\n' "$REPO_ROOT/secrets/${1#/run/secrets/}" ;;
    /app/*)         printf '%s\n' "$REPO_ROOT/${1#/app/}" ;;
    /*)             printf '%s\n' "$1" ;;
    *)              printf '%s\n' "$REPO_ROOT/$1" ;;
  esac
}

# Emits "<config key>\t<configured path>" per configured signing file.
configured_signer_files=$(python3 - "$REPO_ROOT/config/config.json" <<'PY'
import json, sys

KEYS = (
    ("chain.facilitator.seedPhraseFile", ("chain", "facilitator", "seedPhraseFile")),
    ("chain.facilitator.privateKeyFile", ("chain", "facilitator", "privateKeyFile")),
    ("demo.seedPhraseFile", ("demo", "seedPhraseFile")),
)

with open(sys.argv[1], encoding="utf-8") as fh:
    cfg = json.load(fh)

for label, path in KEYS:
    node = cfg
    for part in path:
        node = node.get(part) if isinstance(node, dict) else None
    if isinstance(node, str) and node:
        print(f"{label}\t{node}")
PY
)

mkdir -p "$STAGE_DIR/sensitive/secrets"
chmod 700 "$STAGE_DIR/sensitive/secrets"
signer_count=0
while IFS=$'\t' read -r signer_key configured_path; do
  [ -n "$signer_key" ] || continue
  host_path=$(signer_host_path "$configured_path")
  if [ ! -f "$host_path" ] || [ ! -r "$host_path" ]; then
    log "FATAL: $signer_key -> $host_path is missing or unreadable."
    log "  Refusing to write a snapshot without the signing material it claims to hold."
    log "  Fix the path/permissions, or drop the key if this install does not sign."
    exit 1
  fi
  dest="$STAGE_DIR/sensitive/secrets/$(basename "$host_path")"
  if [ -e "$dest" ]; then
    log "FATAL: two configured signer files share the basename $(basename "$host_path")."
    log "  Give them distinct filenames so the restore is unambiguous."
    exit 1
  fi
  cp -p "$host_path" "$dest"
  # Never log a byte of the file — path and metadata only.
  log "Staged signer: $signer_key -> sensitive/secrets/$(basename "$host_path")" \
      "($(stat -c '%s bytes, mode %a' "$host_path"))"
  signer_count=$((signer_count + 1))
done <<< "$configured_signer_files"

if [ "$signer_count" -eq 0 ]; then
  # Documented non-signing installs (inline dev seedPhrase, or a verify-only
  # deployment) have nothing to stage. Say so rather than failing.
  rmdir "$STAGE_DIR/sensitive/secrets"
  log "Staged: no signer files — config.json names none (non-signing or inline-credential install)"
else
  log "Staged: $signer_count signer file(s) into sensitive/secrets/"
fi

# 1b. Shared VPS infrastructure: the Cloudflare tunnel config + its credential
#     (root-only 0400 file — readable here because this job runs as root) and the
#     three /etc/cron.d backup schedules. Lets a fresh box restore public ingress
#     for all three sites (cardano402.com, thehosksaid.com, tubechat.video) without
#     re-creating the shared tunnel. Tiny; restic dedups.
mkdir -p "$STAGE_DIR/infra"
[ -d "$CLOUDFLARED_DIR" ] && cp -a "$CLOUDFLARED_DIR" "$STAGE_DIR/infra/cloudflared"
for c in "$CRON_DIR/cardano402-backup" "$CRON_DIR/tubechat-backup" "$CRON_DIR/hosksaid-backup"; do
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
