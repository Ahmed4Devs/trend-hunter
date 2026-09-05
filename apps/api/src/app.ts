import { randomUUID } from 'node:crypto';

import fastifySensible from '@fastify/sensible';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import type { Container } from './container';
import authPlugin from './plugins/auth';
import contextPlugin from './plugins/context';
import errorHandlerPlugin from './plugins/error-handler';
import openApiPlugin from './plugins/openapi';
import rateLimitPlugin from './plugins/rate-limit';
import securityPlugin from './plugins/security';
import { registerRoutes } from './routes';

/**
 * Builds the server.
 *
 * Registration order is load-bearing:
 *
 *  1. the error handler, so a failure in any later plugin is still formatted;
 *  2. security headers and CORS, so even a rejected request carries them;
 *  3. auth, because the rate limiter keys on the resolved session;
 *  4. the rate limiter;
 *  5. OpenAPI, which must see every route schema registered after it;
 *  6. the routes.
 */
/**
 * The concrete server type.
 *
 * Inferred rather than annotated as `FastifyInstance`: passing our own pino
 * instance through `loggerInstance` narrows Fastify's logger type, and the
 * generic default would not match.
 */
export type App = ReturnType<typeof buildApp>;

export function buildApp(container: Container) {
  const { env } = container;

  const app = Fastify({
    loggerInstance: container.logger,
    // A caller-supplied id is honoured so a trace can be followed from the
    // browser through the proxy into the API, but it is bounded and sanitised:
    // it ends up in every log line, and an unbounded header would be a log
    // injection vector.
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const supplied = request.headers['x-request-id'];
      if (typeof supplied === 'string') {
        const cleaned = supplied.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        if (cleaned.length >= 8) return cleaned;
      }
      return randomUUID();
    },
    // Bounded so a large body cannot be used to exhaust memory before any
    // handler has had a chance to reject it.
    bodyLimit: env.MAX_BODY_BYTES,
    // Only ever true behind our own proxy. Trusting the header on a directly
    // exposed server lets any client forge its own address and defeat the
    // per-address rate limits.
    trustProxy: env.TRUST_PROXY,
    disableRequestLogging: false,
    // A URL longer than this is never legitimate here and is a cheap way to
    // waste routing time.
    maxParamLength: 200,
    ajv: { customOptions: { allErrors: false } },
  });

  // Zod validates every request and serialises every response, so a handler
  // returning the wrong shape is a server error rather than a silent contract
  // break for the client.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  return app
    .register(errorHandlerPlugin)
    .register(contextPlugin, { container })
    .register(fastifySensible)
    .register(securityPlugin, { env })
    .register(authPlugin, { container })
    .register(rateLimitPlugin, { env, redis: container.redis })
    .register(openApiPlugin, { env })
    .register(registerRoutes, { prefix: '/api/v1' });
}
