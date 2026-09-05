import { requireAdmin, requireUser, type SessionContext } from '@trendhunter/auth';
import type { ApiEnvironment } from '@trendhunter/env';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Container } from '../container';
import { expensiveRateLimit } from '../plugins/rate-limit';

/**
 * Shared route helpers.
 *
 * Every route module is a `FastifyPluginAsyncZod`, which is what gives request
 * and reply full inference from the Zod schemas — a handler cannot return a
 * shape its own schema rejects without the compiler saying so.
 */

export type RouteModule = FastifyPluginAsyncZod;

/** The authenticated caller, or a 401. */
export function currentUser(request: FastifyRequest): SessionContext {
  return requireUser(request.session ?? null);
}

/** The authenticated caller, or a 401/403 if they are not an administrator. */
export function currentAdmin(request: FastifyRequest): SessionContext {
  return requireAdmin(request.session ?? null);
}

/**
 * Route configuration for an endpoint that costs money or queue capacity.
 *
 * Applied to AI generation, translation, search and "Scan Now" — the endpoints
 * where an unbounded caller can spend a provider quota or flood the workers.
 */
export function expensive(env: ApiEnvironment) {
  return { rateLimit: expensiveRateLimit(env) };
}

/** Reads the container off the server instance inside a route module. */
export function containerOf(app: { container: Container }): Container {
  return app.container;
}
