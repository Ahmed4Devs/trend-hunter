# Backup and restore

Two scripts, both in `scripts/`. Neither runs itself: a backup that nobody
scheduled does not exist, and this file does not claim one is running anywhere.

## What is backed up

`pg_dump` in PostgreSQL's custom format, compressed, of the whole application
database. That includes the extensions, so `pgvector` and `pg_trgm` come back
with the schema rather than needing a manual `CREATE EXTENSION` afterwards.

What is **not** backed up, and why it does not need to be:

| | |
|---|---|
| Redis | It holds queue state and cache. A lost queue re-fills on the next scan; a lost cache re-computes. |
| Uploaded files | There are none. Everything the product stores is a row. |
| Caddy's volume | Certificates re-issue. Worth keeping to avoid ACME rate limits, not worth a database-grade backup. |

## Taking one

```bash
cd /opt/trendhunter
./scripts/backup-database.sh                 # writes ./backups/
./scripts/backup-database.sh /mnt/backups    # or somewhere else
```

Each run writes `trendhunter-<UTC timestamp>.dump` and then deletes anything
older than `BACKUP_RETENTION_DAYS` (14 by default). An empty dump is deleted
rather than kept: a zero-byte file that looks like a backup is worse than no
file at all.

## Scheduling it

Nightly, on the host, as the user that owns the deployment:

```bash
crontab -e
```

```cron
15 3 * * * cd /opt/trendhunter && ./scripts/backup-database.sh >> /var/log/trendhunter-backup.log 2>&1
```

A backup on the same disk as the database survives a bad migration but not a
dead disk. Copy the directory off the host — `rsync` to another machine, or an
object store — and treat that copy as the real one:

```cron
30 3 * * * rsync -az --delete /opt/trendhunter/backups/ backup@elsewhere:/srv/trendhunter/
```

## Restoring

```bash
./scripts/restore-database.sh backups/trendhunter-20260101T031500Z.dump
```

The script stops the API, worker and web containers first — a half-restored
schema under live traffic is worse than a few minutes of downtime — restores in
a single transaction, and starts them again. It asks for the database name to be
typed out before it does any of that, because the one time this script gets used
is the one time nobody can afford it to be pointed at the wrong database.

## Proving the backup works

An untested backup is a hypothesis. Restore one into a scratch database
periodically — quarterly is a reasonable floor, and after any change to the
schema or to these scripts:

```bash
docker compose -f docker-compose.production.yml exec postgres \
  createdb -U "$POSTGRES_USER" trendhunter_restore_check

TARGET_DB=trendhunter_restore_check ./scripts/restore-database.sh backups/<file>.dump

docker compose -f docker-compose.production.yml exec postgres \
  psql -U "$POSTGRES_USER" -d trendhunter_restore_check \
  -c "select count(*) from posts; select count(*) from topics;"

docker compose -f docker-compose.production.yml exec postgres \
  dropdb -U "$POSTGRES_USER" trendhunter_restore_check
```

If those counts are plausible, the backup is real. If the restore fails, it is
better to find out on a Tuesday afternoon than during an incident.

## Before an update

Always, when the update carries a migration:

```bash
./scripts/backup-database.sh
git pull
docker compose -f docker-compose.production.yml up -d --build
```

There are no down-migrations in this project — a generated reverse migration is
a guess about data it has never seen — so this backup is the rollback path for
anything the schema touched. See [Deployment](deployment.md#rollback).
