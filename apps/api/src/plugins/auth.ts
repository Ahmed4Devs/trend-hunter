import { fromNodeHeaders, resolveSession, type SessionContext } from '@trendhunter/auth';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Container } from '../container';
import { authRateLimit } from './rate-limit';

declare module 'fastify' {
  interface FastifyRequest {
    /** The caller's session, or `undefined` when anonymous. */
    session?: SessionContext | undefined;
  }
}

export interface AuthPluginOptions {
  readonly container: Container;
}

/**
 * Mounts Better Auth and resolves the session for every request.
 *
 * Two things here are easy to get wrong and expensive to get wrong.
 *
 * **The body.** Better Auth's handler needs the raw request body, but Fastify's
 * built-in JSON parser has already consumed the stream and produced an object
 * by the time a handler runs. Registering a `'*'` parser is not enough — `'*'`
 * is only the *fallback*, and the built-in `application/json` parser still
 * wins — so the auth routes live in their own encapsulated scope where all
 * parsers are removed and the body is passed through as a Buffer. That also
 * keeps `application/x-www-form-urlencoded` working, which the sign-in endpoint
 * accepts.
 *
 * **Set-Cookie.** Iterating `response.headers` collapses repeated headers into
 * one comma-joined value. With the session cookie cache enabled Better Auth
 * emits two `Set-Cookie` headers, and a browser rejects the joined form
 * outright — the user simply never gets a session, with no error anywhere.
 * `getSetCookie()` returns them as an array, which is what is forwarded.
 */
/**
 * Resolves the session for every request.
 *
 * Split from the auth routes below so it can be registered *before* the rate
 * limiter while the routes are registered *after* it. Fastify copies the parent
 * instance's hooks into a child when the child is created, so a scope created
 * before the limiter loads never receives its hook — which is how the auth
 * endpoints ended up with no Fastify rate limiting at all.
 */
const sessionPlugin: FastifyPluginAsync<AuthPluginOptions> = (app, options) => {
  const { auth } = options.container;

  // Resolve the session once per request, before any handler or rate limiter
  // runs, so both can key on the caller's identity.
  app.addHook('onRequest', async (request: FastifyRequest) => {
    try {
      request.session = (await resolveSession(auth, request.headers)) ?? undefined;
    } catch (error) {
      // A session lookup failure must not turn every request into a 500; the
      // caller is simply treated as anonymous and the guards refuse them.
      request.log.warn({ err: error }, 'failed to resolve session');
      request.session = undefined;
    }
  });

  return Promise.resolve();
};

const authRoutesPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  const { auth } = options.container;

  await app.register((scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    scope.route({
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      url: '/api/auth/*',
      // Better Auth applies its own, stricter per-endpoint rules; this is the
      // outer bound, keyed by address because an unauthenticated caller has no
      // account to key on. It is only reachable because this plugin is
      // registered after the rate limiter.
      config: { rateLimit: authRateLimit(options.container.env) },
      // The routes are described by Better Auth, not by our Zod schemas, so
      // they are hidden from the generated OpenAPI document rather than
      // appearing in it untyped.
      schema: { hide: true },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const url = new URL(request.url, options.container.env.BETTER_AUTH_URL);

        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            body:
              request.method === 'GET' || request.method === 'HEAD'
                ? undefined
                : (request.body as Buffer | undefined),
          }),
        );

        void reply.status(response.status);
        for (const [key, value] of response.headers) {
          if (key.toLowerCase() === 'set-cookie') continue;
          void reply.header(key, value);
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) void reply.header('set-cookie', cookies);

        const body = response.body === null ? null : Buffer.from(await response.arrayBuffer());
        return reply.send(body);
      },
    });

    return Promise.resolve();
  });
};

export const authSession = fp(sessionPlugin, { name: 'auth-session' });
export const authRoutes = fp(authRoutesPlugin, { name: 'auth-routes' });
