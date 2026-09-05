import fastifyRateLimit from '@fastify/rate-limit';
import type { ApiEnvironment } from '@trendhunter/env';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

import { errorBody } from '../http/envelope';

/**
 * Rate limiting.
 *
 * Three budgets, because the endpoints differ by orders of magnitude in what
 * they cost:
 *
 *  * the global budget protects the process;
 *  * the auth budget prices out credential stuffing;
 *  * the expensive budget guards everything that spends money or queue capacity
 *    — AI generation, translation, search and "Scan Now". Without it, one
 *    client can drain a paid provider quota or flood the queues from a browser.
 *
 * Counters live in Redis so the limit is shared across API replicas. An
 * in-memory limiter multiplies the real limit by the number of instances, which
 * is the failure mode that looks fine on one machine.
 */

export interface RateLimitOptions {
  readonly env: ApiEnvironment;
  readonly redis: Redis;
}

/**
 * Identifies the client.
 *
 * A signed-in user is limited per account, so sharing an office IP does not
 * make one user's activity exhaust everyone's budget. Anonymous traffic falls
 * back to the address, which behind the proxy is the real client because
 * `trustProxy` is configured from the environment.
 */
function keyGenerator(request: FastifyRequest): string {
  const userId = request.session?.user.id;
  return userId === undefined ? `ip:${request.ip}` : `user:${userId}`;
}

const rateLimitPlugin: FastifyPluginAsync<RateLimitOptions> = async (app, options) => {
  const { env, redis } = options;

  await app.register(fastifyRateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    redis,
    // Namespaced so a Redis flush of the cache cannot silently reset limits.
    nameSpace: 'trendhunter:ratelimit:global:',
    keyGenerator,
    // The health and readiness probes must never be limited: a limiter that
    // rate-limits the probe takes the service out of rotation under load.
    allowList: (request) =>
      request.url.startsWith('/api/v1/health') || request.url.startsWith('/api/v1/ready'),
    // A limited client is told when to come back rather than being left to
    // guess and retry immediately.
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (request, context) =>
      errorBody('RATE_LIMITED', `Too many requests. Retry in ${context.after}.`, {
        requestId: request.id,
        details: { limit: context.max, windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS },
      }),
  });
};

export default fp(rateLimitPlugin, { name: 'rate-limit' });

/**
 * Per-route configuration for endpoints that cost real money or queue capacity.
 *
 * Applied as `config.rateLimit` on the route, which overrides the global budget
 * for that route only.
 */
export function expensiveRateLimit(env: ApiEnvironment) {
  return {
    max: env.EXPENSIVE_RATE_LIMIT_MAX,
    timeWindow: env.EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS * 1000,
    keyGenerator,
  };
}

/** The tighter budget for authentication endpoints. */
export function authRateLimit(env: ApiEnvironment) {
  return {
    max: env.AUTH_RATE_LIMIT_MAX,
    timeWindow: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
    // Always by address: an unauthenticated caller has no account to key on,
    // and keying a sign-in attempt by the account being attacked would let an
    // attacker lock a victim out.
    keyGenerator: (request: FastifyRequest) => `ip:${request.ip}`,
  };
}
