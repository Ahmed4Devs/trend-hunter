import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import type { ApiEnvironment } from '@trendhunter/env';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Transport-level security headers and cross-origin policy.
 *
 * The API serves JSON to one known web application, which makes both decisions
 * here unusually strict — and correctly so. There is no third-party embedding
 * to support, no CDN to whitelist and no browser page to render, so anything
 * permissive would be permitting something nothing actually needs.
 */

export interface SecurityOptions {
  readonly env: ApiEnvironment;
}

const securityPlugin: FastifyPluginAsync<SecurityOptions> = async (app, options) => {
  const { env } = options;

  // The allowlist. `APP_URL` is always permitted; extra origins are only for
  // development, where the web dev server runs on a different port.
  const allowedOrigins = new Set([env.APP_URL, ...env.CORS_ALLOWED_ORIGINS]);

  await app.register(fastifyCors, {
    /**
     * A function rather than an array, so a request with no Origin header — a
     * server-to-server call, curl, the health probe — is allowed while an
     * unknown browser origin is refused. Returning the request's own origin
     * for anything else would be `Access-Control-Allow-Origin: *` with extra
     * steps, and with credentials enabled that is an account takeover.
     */
    origin(origin, callback) {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      app.log.warn({ origin }, 'blocked a cross-origin request from an unlisted origin');
      callback(null, false);
    },
    // Session cookies must be sent, which is exactly why the origin check above
    // cannot be relaxed.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 86_400,
  });

  await app.register(fastifyHelmet, {
    /**
     * A JSON API renders nothing, so the policy denies everything. `frame-ancestors`
     * is what actually matters here: it stops the API being framed, which is the
     * only clickjacking surface an API has.
     */
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        // Swagger UI is served from this origin in development and needs its
        // own styles and scripts; it is disabled entirely in production.
        ...(env.ENABLE_API_DOCS
          ? {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
              connectSrc: ["'self'"],
            }
          : {}),
      },
    },
    // Only meaningful over TLS, and asserting it over plain http in development
    // would pin the browser to https for localhost.
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    // The API is not a website; these protect the browser if a response is ever
    // rendered directly.
    noSniff: true,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    // Deprecated and actively harmful on modern browsers; CSP replaces it.
    xssFilter: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // Disabled: it would require CORP headers on every resource the docs load.
    crossOriginEmbedderPolicy: false,
  });

  // Fastify sets no Permissions-Policy of its own, and helmet does not either.
  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
    );
    done(null, payload);
  });
};

export default fp(securityPlugin, { name: 'security' });
