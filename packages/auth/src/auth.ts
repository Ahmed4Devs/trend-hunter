import { redisStorage } from '@better-auth/redis-storage';
import type { Database } from '@trendhunter/database';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin } from 'better-auth/plugins';

import {
  AUTH_RATE_LIMITS,
  PASSWORD_POLICY,
  ROLE_SLUGS,
  SESSION_LIFETIME,
  type AuthConfig,
} from './config';

/**
 * The Better Auth server.
 *
 * Built as a function rather than a module-level singleton so that each service
 * owns its instance and a test can construct one against a throwaway database.
 *
 * Sign-up over HTTP is deliberately disabled. This is a single-operator
 * intelligence tool, not a public SaaS: accounts are created by the seed script
 * or by an administrator through the admin plugin. An open registration
 * endpoint on a self-hosted deployment is a standing invitation to fill the
 * database with accounts that then consume AI quota.
 */

export function createAuth(database: Database, config: AuthConfig) {
  const secondaryStorage =
    config.redis === undefined
      ? undefined
      : redisStorage({
          // The structural RedisLike interface is narrower than ioredis, which
          // is what keeps this package free of a client dependency.
          client: config.redis as never,
          keyPrefix: 'trendhunter:auth:',
        });

  return betterAuth({
    appName: 'TrendHunter',
    secret: config.secret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',

    database: prismaAdapter(database, {
      provider: 'postgresql',
      // PostgreSQL supports it, and account creation writes two tables: without
      // a transaction a failure between them leaves a user who cannot sign in.
      transaction: true,
    }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: PASSWORD_POLICY.minLength,
      maxPasswordLength: PASSWORD_POLICY.maxLength,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
    },

    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: ROLE_SLUGS.user,
          // Without this a client could send `role: "admin"` at sign-up and
          // assign itself elevated access.
          input: false,
        },
      },
    },

    session: {
      expiresIn: SESSION_LIFETIME.expiresInSeconds,
      updateAge: SESSION_LIFETIME.updateAgeSeconds,
      freshAge: SESSION_LIFETIME.freshAgeSeconds,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_LIFETIME.cookieCacheSeconds,
      },
      // Keep the row even with Redis in front, so sessions remain listable and
      // revocable from the database if Redis is flushed.
      storeSessionInDatabase: secondaryStorage !== undefined,
    },

    // The origin check that backs CSRF protection. An empty allowlist would
    // reject every browser request; `*` would accept every attacker's page.
    trustedOrigins: [...config.trustedOrigins],

    advanced: {
      cookiePrefix: 'trendhunter',
      // Adds the `__Secure-` prefix and the Secure attribute. In development
      // over plain http the browser would refuse such a cookie outright.
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        // Lax, not None: the web app and the API are same-origin in production
        // and same-site in development (different ports on localhost are
        // same-site), so None would weaken the cookie for no benefit.
        sameSite: 'lax',
        path: '/',
      },
    },

    rateLimit: {
      // Better Auth defaults this to production-only; brute force is worth
      // limiting in development too, where it is also how the limit gets tested.
      enabled: true,
      window: AUTH_RATE_LIMITS.window,
      max: AUTH_RATE_LIMITS.max,
      storage: secondaryStorage === undefined ? 'memory' : 'secondary-storage',
      customRules: { ...AUTH_RATE_LIMITS.rules },
    },

    ...(secondaryStorage === undefined ? {} : { secondaryStorage }),

    plugins: [admin({ defaultRole: ROLE_SLUGS.user, adminRoles: [ROLE_SLUGS.admin] })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
