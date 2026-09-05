# =============================================================================
# TrendHunter API — production image
# =============================================================================
# Built from the repository root:
#   docker build -f apps/api/Dockerfile -t trendhunter-api .
#
# The build is staged so that the layer holding the dependency install is
# invalidated only by a lockfile change, not by every source edit.
# =============================================================================

# Pinned to a digest-stable minor rather than `24` so two builds a month apart
# produce the same base.
FROM node:24.11-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# --- dependencies -----------------------------------------------------------
# Only the manifests are copied, so this layer is reused until one of them
# changes. `--frozen-lockfile` makes a lockfile that disagrees with a manifest
# a build failure rather than a silent resolution.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/clustering/package.json packages/clustering/
COPY packages/config/package.json packages/config/
COPY packages/connectors/package.json packages/connectors/
COPY packages/content/package.json packages/content/
COPY packages/database/package.json packages/database/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/env/package.json packages/env/
COPY packages/observability/package.json packages/observability/
COPY packages/ranking/package.json packages/ranking/
COPY packages/search/package.json packages/search/
COPY packages/seed/package.json packages/seed/
COPY packages/shared/package.json packages/shared/
COPY packages/translation/package.json packages/translation/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
# The Prisma client is generated TypeScript, not a binary, so it is produced
# here and bundled by tsup along with everything else.
# `prisma generate` never opens a connection, but `prisma.config.ts` resolves
# the datasource URL when the config loads and throws when it is missing. This
# placeholder points at nothing, carries no password — a Dockerfile `ENV` takes
# the rest of the line as its value, so there is nowhere to put a scanner
# pragma — and never leaves the build stage.
ENV DATABASE_URL=postgresql://build@127.0.0.1:5432/build
RUN pnpm --filter @trendhunter/database db:generate \
 && pnpm --filter @trendhunter/api build

# `deploy` resolves the workspace protocol and writes a self-contained tree with
# production dependencies only. The bundle already inlines every `@trendhunter/*`
# source; what is installed here is the third-party runtime — including BullMQ,
# which loads its Lua command files from its own package directory and therefore
# must exist on disk rather than inside the bundle.
RUN pnpm --filter @trendhunter/api --prod deploy --legacy /deploy

# --- runtime ----------------------------------------------------------------
FROM node:24.11-alpine AS runtime
ENV NODE_ENV=production
# Alpine's node image already ships an unprivileged `node` user; a process that
# is compromised should not be able to write to its own image.
USER node
WORKDIR /app

COPY --chown=node:node --from=build /deploy/node_modules ./node_modules
COPY --chown=node:node --from=build /repo/apps/api/dist ./dist
COPY --chown=node:node --from=build /repo/apps/api/package.json ./package.json

EXPOSE 4000

# The container is only "healthy" once the process answers, which is what makes
# `depends_on: condition: service_healthy` mean something for the web container.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
