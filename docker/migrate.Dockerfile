# =============================================================================
# TrendHunter — schema migration
# =============================================================================
# A one-shot container that applies pending migrations and exits. The services
# wait on it with `service_completed_successfully`, so a deploy either migrates
# and starts, or fails before anything serves a request against a schema the
# code does not expect.
#
# Deliberately a separate image from the services: it needs the Prisma CLI and
# the migration SQL, and neither belongs in a runtime image that should not be
# able to alter the schema at all.
# =============================================================================

FROM node:24.11-alpine
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable

# Everything below runs as the unprivileged `node` user the image already ships.
# This container holds the only credentials in the deployment that can alter the
# schema, so it should not also be able to write to its own filesystem as root.
RUN mkdir -p /repo /pnpm && chown -R node:node /repo /pnpm
USER node
WORKDIR /repo

COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY --chown=node:node packages/database/package.json packages/database/
# `--ignore-scripts` is not used: Prisma's postinstall is one of the reviewed
# build scripts, and the CLI does not work without it.
RUN pnpm install --frozen-lockfile --filter @trendhunter/database...

COPY --chown=node:node packages/database packages/database

# `migrate deploy`, never `migrate dev`: it applies committed migrations and
# nothing else. `dev` would try to generate a new one from a schema difference,
# which in production means inventing DDL nobody reviewed.
CMD ["pnpm", "--filter", "@trendhunter/database", "run", "db:deploy"]
