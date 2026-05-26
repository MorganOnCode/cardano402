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

require_private_file() {
  local path="$1"
  local label="$2"
  if [ ! -r "$path" ]; then
    echo "FATAL: $path missing or unreadable" >&2
    return 1
  fi
  if [ ! -f "$path" ]; then
    echo "FATAL: $path is not a regular file" >&2
    return 1
  fi
  local mode
  mode=$(stat -c '%a' "$path")
  if [ $((8#$mode & 0077)) -ne 0 ]; then
    echo "FATAL: $label must not be group/world readable or writable: $path" >&2
    return 1
  fi
}

if ! require_private_file "$ENV_FILE" "restic env file"; then
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
