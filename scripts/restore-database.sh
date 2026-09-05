#!/usr/bin/env bash
# =============================================================================
# TrendHunter — PostgreSQL restore
# =============================================================================
#   ./scripts/restore-database.sh backups/trendhunter-20260101T031500Z.dump
#
# THIS REPLACES THE CONTENTS OF THE TARGET DATABASE. It refuses to run without
# an explicit confirmation, because the one time it is used is the one time
# nobody can afford it to be run against the wrong database.
#
# Restoring is also the only way to know a backup works. Do it periodically
# into a scratch database:
#   TARGET_DB=trendhunter_restore_check ./scripts/restore-database.sh <file>
# =============================================================================
set -euo pipefail

ARCHIVE="${1:?usage: restore-database.sh <dump-file>}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

if [[ ! -s "$ARCHIVE" ]]; then
  echo "No such backup, or it is empty: ${ARCHIVE}" >&2
  exit 1
fi

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER is not set — is .env present?}"
TARGET_DB="${TARGET_DB:-${POSTGRES_DB:?POSTGRES_DB is not set}}"

echo "About to restore ${ARCHIVE} into database '${TARGET_DB}'."
echo "Every table it contains will be dropped and recreated."
read -r -p "Type the database name to continue: " CONFIRMATION
if [[ "$CONFIRMATION" != "$TARGET_DB" ]]; then
  echo "Aborted." >&2
  exit 1
fi

# The application must not be writing while this runs; a half-restored schema
# under live traffic is worse than a few minutes of downtime.
echo "Stopping the application containers"
docker compose -f "$COMPOSE_FILE" stop api worker web || true

echo "Restoring"
# `--clean --if-exists` drops what the dump is about to recreate. `--no-owner`
# because the dump was taken that way; ownership belongs to whoever restores.
# Extensions are restored too, so pgvector and pg_trgm come back with the
# schema rather than needing a manual CREATE EXTENSION afterwards.
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$TARGET_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --single-transaction \
  < "$ARCHIVE"

echo "Starting the application containers"
docker compose -f "$COMPOSE_FILE" start api worker web

echo "Restored. Check the dashboard and the scan history before declaring victory."
