#!/usr/bin/env bash
# cardano402 restore — restore a backup snapshot to a target directory.
#
# Usage:
#   bash scripts/restore.sh                       # restore latest to /tmp
#   bash scripts/restore.sh latest /tmp/restore
#   bash scripts/restore.sh <snapshot-id> <dir>
#   bash scripts/restore.sh list                  # list available snapshots
#
# This script intentionally does NOT restore over the live /opt/cardano402
# tree. Restores always go to a target dir for inspection. Production
# recovery is a manual operator step that copies specific files back.

set -euo pipefail

ACTION="${1:-latest}"
TARGET="${2:-/tmp/cardano402-restore-$(date +%s)}"
ENV_FILE="${CARDANO402_RESTIC_ENV:-/etc/cardano402/restic.env}"

if [ ! -r "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE missing or unreadable" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$ENV_FILE"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY not set in $ENV_FILE}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD not set in $ENV_FILE}"
export RESTIC_REPOSITORY RESTIC_PASSWORD
[ -n "${B2_ACCOUNT_ID:-}" ] && export B2_ACCOUNT_ID B2_ACCOUNT_KEY
[ -n "${AWS_ACCESS_KEY_ID:-}" ] && export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

if ! command -v restic >/dev/null 2>&1; then
  echo "FATAL: restic not installed. apt install restic" >&2
  exit 1
fi

if [ "$ACTION" = "list" ]; then
  restic snapshots --tag automated --compact
  exit 0
fi

mkdir -p "$TARGET"
# Restored snapshots hold config.json, .env, signing files and payment-gated
# content. Lock the target before restic writes into it, not after.
chmod 700 "$TARGET"

echo "Restoring snapshot '$ACTION' to $TARGET ..."
restic restore "$ACTION" --target "$TARGET"

echo
echo "Restore complete."
echo "Target: $TARGET"
echo
echo "Inventory (top-level):"
find "$TARGET" -maxdepth 4 -type f | sort | head -40
echo
echo "MANIFEST.txt contents (if present):"
find "$TARGET" -name MANIFEST.txt -exec cat {} \; 2>/dev/null

# Signer coverage. Snapshots taken before signer staging existed restore
# cleanly but cannot rebuild a signing facilitator — say so loudly here rather
# than letting an operator discover it mid-recovery.
echo
signer_dir=$(find "$TARGET" -type d -path '*/sensitive/secrets' -print -quit 2>/dev/null || true)
if [ -n "$signer_dir" ]; then
  echo "Signing files in this snapshot (names/modes only, contents never printed):"
  find "$signer_dir" -type f -exec stat -c '  %n  mode %a  uid:gid %u:%g  %s bytes' {} \;
else
  echo "WARNING: this snapshot contains no sensitive/secrets/ directory."
  echo "  Either this install does not sign locally, or the snapshot predates"
  echo "  signer staging in scripts/backup.sh. Recover signing material from"
  echo "  your offline seed backup — see docs/backup-restore.md, Scenario C."
fi
