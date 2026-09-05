# =============================================================================
# TrendHunter web — production image
# =============================================================================
# Built from the repository root:
#   docker build -f apps/web/Dockerfile -t trendhunter-web .
#
# NOTE: `NEXT_PUBLIC_*` values are compiled into the browser bundle, so they are
# build arguments rather than runtime environment. Changing the public API URL
# means rebuilding this image; there is no way around that short of shipping a
# runtime config endpoint, and one origin per deployment is the simpler trade.
# =============================================================================

FROM node:24.11-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

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

FROM deps AS build
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_DEFAULT_LOCALE=en
ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# The web app imports `@trendhunter/database` types transitively; generating the
# client keeps those imports resolvable during the type-checked build.
# `prisma generate` never opens a connection, but `prisma.config.ts` resolves
# the datasource URL when the config loads and throws when it is missing. This
# placeholder points at nothing, carries no password — a Dockerfile `ENV` takes
# the rest of the line as its value, so there is nowhere to put a scanner
# pragma — and never leaves the build stage.
ENV DATABASE_URL=postgresql://build@127.0.0.1:5432/build
RUN pnpm --filter @trendhunter/database db:generate \
 && pnpm --filter @trendhunter/web build

# --- runtime ----------------------------------------------------------------
FROM node:24.11-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
USER node
WORKDIR /app

# Next's standalone output carries its own minimal `node_modules`, so nothing is
# installed here. `static` and `public` are copied separately because the
# standalone trace deliberately excludes them — they are served by the server it
# does contain.
COPY --chown=node:node --from=build /repo/apps/web/.next/standalone ./
COPY --chown=node:node --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/sign-in').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

# The trace root is the repository, so the server entry keeps its workspace path.
CMD ["node", "apps/web/server.js"]
