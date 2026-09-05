# TrendHunter

Content intelligence and trend discovery. It collects what is being said about
your interests across five sources, works out what is actually rising, tells you
where the Arabic gap is, and helps you write something worth posting about it.

It never posts for you. Publishing is a decision, and V1 leaves it to a person.

---

## What it does

| | |
|---|---|
| **Collects** | X, Reddit, Hacker News, RSS and GitHub, behind one connector interface. Offline mock connectors are the default, so the whole product runs with no credentials at all. |
| **Normalises** | One internal format, language detection, Arabic folding, engagement flattened onto one comparable scale, layered deduplication. |
| **Understands** | pgvector embeddings, hybrid keyword + semantic search, topic clustering, relevance against your stated interests. |
| **Ranks** | A trend score with every component stored beside it, so the interface can explain why something is trending rather than assert it. |
| **Surfaces** | Emerging trends, hidden gems, and an Arabic opportunity score: high English volume against Arabic scarcity. |
| **Writes** | Drafts and X threads from a topic, translation into Arabic that reads like Arabic, whole-thread translation that keeps the thread a thread. |
| **Records** | What you published by hand, so "generated" and "actually shipped" stay comparable. |

---

## Stack

Node 24 · TypeScript · pnpm workspaces · Turborepo
Next.js 16 (App Router, React 19) · Tailwind v4 · Radix · Recharts · TanStack Table
Fastify 5 · Zod · Better Auth · BullMQ · Prisma 7 · PostgreSQL 18 + pgvector · Redis 8
Vitest · Playwright · Docker · Caddy

---

## Getting started

Requirements: Node 24+, pnpm 11+, Docker.

```bash
git clone <repository-url> trendhunter
cd trendhunter
pnpm install

cp .env.example .env          # then read it; the defaults are safe for local use
pnpm docker:up                # PostgreSQL + Redis, bound to 127.0.0.1 only
pnpm db:migrate               # create the schema
pnpm db:seed                  # demo account, interests, the five sources
pnpm dev                      # web on :3000, API on :4000, worker alongside
```

Then open <http://localhost:3000> and sign in with the seeded demo account:

```text
demo@trendhunter.local / TrendHunter123!
```

That password is published on purpose: it exists so a reviewer can sign in to a
local instance. `ENABLE_DEMO_ACCOUNT` is forced to `false` in production by the
environment validator, so the account cannot exist on a deployed instance.

The database starts empty of content on purpose. Press **New scan**, or wait for
the scheduled collection, and the pipeline fills it. Seeded posts would make the
dashboard look populated while proving nothing about whether collection,
normalisation, clustering and scoring actually work.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Every service in watch mode. |
| `pnpm build` | Production build of every app and package. |
| `pnpm lint` / `pnpm lint:fix` | ESLint across the workspace. |
| `pnpm typecheck` | `tsc --noEmit` everywhere. |
| `pnpm test` | Unit and integration tests (Vitest). |
| `pnpm test:e2e` | Browser tests (Playwright). Needs the stack running. |
| `pnpm verify` | lint + typecheck + test + build. The gate before a commit. |
| `pnpm format` / `pnpm format:check` | Prettier. |
| `pnpm secrets:scan` | Refuses a commit that contains a credential. |
| `pnpm db:migrate` | Create and apply a migration in development. |
| `pnpm db:deploy` | Apply committed migrations. What production runs. |
| `pnpm db:seed` | Idempotent seed. |
| `pnpm db:studio` | Prisma Studio. |
| `pnpm db:reset` | Drop, recreate, migrate, seed. Destructive. |
| `pnpm db:check-drift` | Fails if a migration drops an index Prisma cannot represent. |
| `pnpm docker:up` / `:down` / `:logs` / `:reset` | Local infrastructure. |

---

## How it is laid out

```text
apps/
  api/          Fastify REST API and OpenAPI document
  web/          Next.js application
  worker/       BullMQ consumers: collection, normalisation, scoring, AI jobs
packages/
  ai/           LLM abstraction with a deterministic offline provider
  auth/         Better Auth configuration, guards, operator provisioning
  clustering/   Topic clustering
  connectors/   The five source adapters behind one interface
  content/      Draft and thread generation
  database/     Prisma schema, repositories, vector and full-text SQL
  embeddings/   Embedding service
  env/          Validated environment, per service
  observability/Structured logging
  ranking/      Relevance, trend and Arabic opportunity engines
  search/       Hybrid search
  seed/         Database seed
  shared/       Constants, errors, pure helpers
  translation/  Arabic translation and terminology handling
  types/        The shared vocabulary. No runtime dependencies.
  ui/           Design system: tokens, primitives, charts, data grid
  validation/   Zod schemas: the API's trust boundary
```

The dependency rule is one-directional: `apps` may depend on `packages`, and a
package may depend on packages below it. Nothing in `packages` imports from
`apps`, and no package reads `process.env` — configuration is validated once, at
a composition root, and passed down.

---

## Documentation

- [API](docs/api.md) — the envelope, the error codes, and the whole surface
- [Testing](docs/testing.md) — the three layers, and how to run the browser tests
- [Deployment](docs/deployment.md) — IONOS VPS, Caddy, HTTPS, updates, rollback
- [Backup and restore](docs/backups.md) — what is backed up, and how to prove it
- [Architecture notes](docs/architecture.md) — the decisions worth knowing about
- [Security](docs/security.md) — the trust boundaries and what enforces them

The API documents itself: with `ENABLE_API_DOCS=true`, the OpenAPI explorer is
at `/docs` and the document at `/docs/json`. It is off by default in production.

---

## Licence

UNLICENSED. All rights reserved.
