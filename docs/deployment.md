# Deployment

Target: an IONOS VPS L+ running Ubuntu, with everything in Docker behind Caddy.
Nothing here is specific to IONOS beyond the sizing note — any Ubuntu host with
Docker works the same way.

## The shape of it

```text
                 Internet
                    |
              :80 / :443
                    |
                 +--v----+       the only container that publishes a port
                 | Caddy |       automatic HTTPS, compression, security headers
                 +--+--+-+
        /api/*      |  |     everything else
      +-------------+  +-------------+
      |                              |
 +----v----+                    +----v----+
 | Fastify |                    | Next.js |
 +--+---+--+                    +----+----+
    |   |                            |  Server Components call the API over the
    |   |                            |  internal network, not back through Caddy
    |   +------------+---------------+
    |                |
+---v----+      +----v---+      +--------+
|Postgres|      | Redis  |<-----| Worker |
+--------+      +--------+      +---+----+
     ^                              |
     +------------------------------+
```

One public origin. The web app and the API share it, which is what lets the
session cookie stay `SameSite=Lax` with no CORS exemption: a cross-origin split
would force `SameSite=None`, and a cookie that travels on cross-site requests is
a cookie that can be replayed by one.

PostgreSQL and Redis publish nothing. They are reachable on the internal Docker
network and nowhere else, so a firewall mistake cannot expose a database that
was never listening publicly in the first place.

## Sizing

An IONOS VPS L+ (8 vCPU, 24 GB) is comfortable. The parts that want memory are
PostgreSQL's HNSW index builds — `maintenance_work_mem` is raised to 256 MB in
the compose file for exactly this — and the embedding jobs. 8 GB works with
`WORKER_CONCURRENCY=2`; below that, collection and clustering start contending.

## First deployment

### 1. The host

```bash
# As root, once.
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

adduser --disabled-password --gecos "" trendhunter
usermod -aG docker trendhunter
```

Firewall: SSH and HTTP(S) only. Nothing else needs to be reachable.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Harden SSH before the host is exposed: keys only, no root login.

```bash
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
```

### 2. DNS

Point an `A` record — and `AAAA` if the host has IPv6 — at the server *before*
the first start. Caddy requests a certificate on boot, and a name that does not
resolve yet produces a failed ACME attempt that is rate-limited on retry.

### 3. Configuration

```bash
su - trendhunter
git clone <repository-url> /opt/trendhunter
cd /opt/trendhunter

cp .env.example .env
chmod 600 .env
```

Generate a separate secret for each of these. Never reuse one:

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -base64 32   # POSTGRES_PASSWORD  (superuser)
openssl rand -base64 32   # APP_DB_PASSWORD    (the application role)
openssl rand -base64 32   # REDIS_PASSWORD
```

The values that must not be left at their defaults:

```dotenv
NODE_ENV=production
DOMAIN=trendhunter.example.com
ACME_EMAIL=ops@example.com

APP_URL=https://trendhunter.example.com
API_URL=https://trendhunter.example.com
BETTER_AUTH_URL=https://trendhunter.example.com
NEXT_PUBLIC_APP_URL=https://trendhunter.example.com
NEXT_PUBLIC_API_URL=https://trendhunter.example.com
API_INTERNAL_URL=http://api:4000

DATABASE_URL=postgresql://<app-user>:<app-password>@postgres:5432/trendhunter?schema=public&connection_limit=10
REDIS_URL=redis://:<redis-password>@redis:6379

# The superuser the container is created with. Used once, to create the
# extensions and the application role, and by nothing afterwards.
POSTGRES_USER=<superuser>
POSTGRES_PASSWORD=<superuser-password>

# The unprivileged role the application connects as. These must match the
# credentials in DATABASE_URL: the init script creates the role on first start
# and grants it exactly what Prisma needs — no superuser, no CREATE DATABASE,
# no CREATE ROLE, no CREATE EXTENSION.
APP_DB_USER=<app-user>
APP_DB_PASSWORD=<app-password>
```

The environment validator refuses to start a production deployment that still
carries a placeholder, points at a development database, or has the demo
account enabled. A half-configured deployment should fail loudly on boot rather
than serve traffic in a weakened configuration.

### 4. Start

```bash
docker compose -f docker-compose.production.yml up -d --build
```

The `migrate` container runs first and applies the committed migrations; the
services wait on it with `service_completed_successfully`, so nothing serves a
request against a schema the code does not expect.

Watch the first boot, then check it:

```bash
docker compose -f docker-compose.production.yml logs -f caddy api worker

curl -sf https://trendhunter.example.com/api/v1/health
curl -sf https://trendhunter.example.com/api/v1/ready
```

`ready` is the one that matters. It reports the database, Redis, and whether
the worker's heartbeat is fresh — a service that is up but no longer processing
shows up there and nowhere else.

### 5. The first account

Sign-up over HTTP is disabled by design, so the first operator is provisioned
from the host:

```bash
docker compose -f docker-compose.production.yml run --rm \
  -e ADMIN_EMAIL=you@example.com \
  -e ADMIN_PASSWORD='<a long random password>' \
  -e ADMIN_NAME='Your Name' \
  migrate pnpm --filter @trendhunter/seed run seed
```

The seed is idempotent: it creates what is missing and changes nothing that
already exists, including passwords.

## Updates

```bash
cd /opt/trendhunter
git pull

# Build first, switch second: a failed build then costs nothing.
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

Take a backup before any update that carries a migration:

```bash
./scripts/backup-database.sh
```

The web image bakes `NEXT_PUBLIC_*` into the browser bundle, so changing the
public origin needs a rebuild rather than a restart.

## Rollback

Code rolls back by checking out the previous commit and rebuilding:

```bash
git log --oneline -10
git checkout <previous-commit>
docker compose -f docker-compose.production.yml up -d --build
```

**A migration does not roll back with the code.** There are no down-migrations
here, deliberately: a generated reverse migration is a guess about data it has
never seen. If the previous release cannot run against the current schema, the
recovery is the backup taken before the update:

```bash
./scripts/restore-database.sh backups/trendhunter-<timestamp>.dump
```

That is why the pre-update backup is not optional. Plan migrations to be
backwards-compatible with the release before them — add a column, deploy, use
it in the next release, drop the old one in the release after — and the
question rarely comes up.

## Operating

```bash
# What is running, and is it healthy
docker compose -f docker-compose.production.yml ps

# Structured logs, one service at a time
docker compose -f docker-compose.production.yml logs -f api

# A psql shell
docker compose -f docker-compose.production.yml exec postgres psql -U <superuser> -d trendhunter

# Restart one service without touching the rest
docker compose -f docker-compose.production.yml restart worker
```

Disk fills from three places: PostgreSQL, Redis's append-only file, and
Docker's image cache. The maintenance job prunes raw items and job runs on the
retention windows set in `.env`; `docker image prune -f` after an update
handles the rest.

## Certificates

Caddy manages them. The thing to protect is the `caddy-data` volume, which
holds the ACME account key and the issued certificates — losing it means
re-issuing everything, and Let's Encrypt's rate limits will notice.

HSTS is sent with a two-year max-age and `preload`. Do not enable that until
every subdomain is genuinely HTTPS-only: a browser that has seen the header
will refuse plain HTTP for that long, and there is no quick way back.
