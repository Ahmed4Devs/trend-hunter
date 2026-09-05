import { checkDatabaseHealth } from '@trendhunter/database';
import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from '@trendhunter/shared';
import { z } from 'zod';

import { ok, successEnvelope } from '../http/envelope';
import type { RouteModule } from '../http/route';

/**
 * Liveness and readiness.
 *
 * The distinction is the point of having both. `/health` answers "is this
 * process alive" and must never touch a dependency — a health check that fails
 * because PostgreSQL is briefly slow gets the container killed and restarted,
 * which is the opposite of helpful. `/ready` answers "can this process serve
 * traffic", so it does check the dependencies and reports 503 when it cannot.
 *
 * Neither is rate limited (the limiter allowlists them) and neither requires
 * authentication: an orchestrator has no session.
 */

const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  uptimeSeconds: z.number(),
  timestamp: z.iso.datetime(),
});

const dependencySchema = z.object({
  status: z.enum(['up', 'down', 'stale']),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});

const readySchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    database: dependencySchema,
    redis: dependencySchema,
    worker: dependencySchema,
  }),
  timestamp: z.iso.datetime(),
});

export const healthRoutes: RouteModule = (app) => {
  app.route({
    method: 'GET',
    url: '/health',
    schema: {
      operationId: 'getHealth',
      tags: ['health'],
      summary: 'Liveness probe',
      description:
        'Answers as long as the process is running. Touches no dependency, so a slow database cannot cause a restart loop.',
      security: [],
      response: { 200: successEnvelope(healthSchema) },
    },
    handler: () =>
      ok({
        status: 'ok' as const,
        service: 'api' as const,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      }),
  });

  app.route({
    method: 'GET',
    url: '/ready',
    schema: {
      operationId: 'getReadiness',
      tags: ['health'],
      summary: 'Readiness probe',
      description:
        'Checks PostgreSQL, Redis and the worker heartbeat. Answers 503 when a dependency the API needs to serve traffic is unavailable.',
      security: [],
      response: {
        200: successEnvelope(readySchema),
        503: successEnvelope(readySchema),
      },
    },
    handler: async (_request, reply) => {
      const { database, redis } = app.container;

      const [databaseHealth, redisHealth, workerHealth] = await Promise.all([
        checkDatabaseHealth(database),
        checkRedis(),
        checkWorker(),
      ]);

      const checks = {
        database: {
          status: databaseHealth.ok ? ('up' as const) : ('down' as const),
          latencyMs: databaseHealth.latencyMs,
        },
        redis: redisHealth,
        worker: workerHealth,
      };

      // The worker being absent degrades the product but does not stop the API
      // serving what has already been collected, so it is reported and does not
      // fail readiness. A missing database or Redis does.
      const ready = checks.database.status === 'up' && checks.redis.status === 'up';

      return reply.code(ready ? 200 : 503).send(
        ok({
          status: ready ? ('ready' as const) : ('degraded' as const),
          checks,
          timestamp: new Date().toISOString(),
        }),
      );

      async function checkRedis(): Promise<z.infer<typeof dependencySchema>> {
        const startedAt = performance.now();
        try {
          await redis.ping();
          return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
        } catch {
          // The reason can name the host, so it stays in the log.
          return { status: 'down' };
        }
      }

      async function checkWorker(): Promise<z.infer<typeof dependencySchema>> {
        try {
          const beat = await redis.get(WORKER_HEARTBEAT_KEY);
          if (beat === null) return { status: 'down', detail: 'no heartbeat recorded' };
          const ageSeconds = (Date.now() - Number(beat)) / 1000;
          return ageSeconds <= WORKER_HEARTBEAT_TTL_SECONDS
            ? { status: 'up' }
            : { status: 'stale', detail: `last seen ${Math.round(ageSeconds)}s ago` };
        } catch {
          return { status: 'down' };
        }
      }
    },
  });

  return Promise.resolve();
};
