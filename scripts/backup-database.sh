#!/usr/bin/env bash
# =============================================================================
# TrendHunter — PostgreSQL backup
# =============================================================================
#   ./scripts/backup-database.sh [destination-directory]
#
# Writes one timestamped, compressed custom-format dump and prunes anything
# older than the retention window. Custom format rather than plain SQL: it can
# be restored selectively, in parallel, and it compresses.
#
# Run it from cron on the host, e.g. nightly at 03:15:
#   15 3 * * * cd /opt/trendhunter && ./scripts/backup-database.sh >> /var/log/trendhunter-backup.log 2>&1
#
# A backup nobody has restored is a hypothesis, not a backup. Restore into a
# scratch database at least once (see restore-database.sh) before relying on it.
# =============================================================================
set -euo pipefail

DESTINATION="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

# Read the connection details from the same .env the stack uses, so a backup
# can never be taken against a different database than the one running.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

: "${POSTGRES_DB:?POSTGRES_DB is not set — is .env present?}"
: "${POSTGRES_USER:?POSTGRES_USER is not set — is .env present?}"

mkdir -p "$DESTINATION"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${DESTINATION}/trendhunter-${TIMESTAMP}.dump"

echo "Backing up ${POSTGRES_DB} to ${ARCHIVE}"

# `--format=custom` with maximum compression, piped out of the container rather
# than written inside it: the volume is for data, not for its own backups.
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
  > "$ARCHIVE"

# A zero-byte file means the dump failed after the redirect had already created
# it; leaving it in place would look like a successful backup.
if [[ ! -s "$ARCHIVE" ]]; then
  rm -f "$ARCHIVE"
  echo "Backup failed: the dump was empty." >&2
  exit 1
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "Wrote ${ARCHIVE} (${SIZE})"

echo "Pruning backups older than ${RETENTION_DAYS} days"
find "$DESTINATION" -name 'trendhunter-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "Done."
