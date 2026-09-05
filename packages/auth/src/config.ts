import type { UserRole } from '@trendhunter/types';

/**
 * Authentication configuration.
 *
 * Every value here is supplied by the composition root from a validated
 * environment. Nothing in this package reads `process.env`, so the same
 * configuration can be built for a test with no infrastructure at all.
 */

export interface AuthConfig {
  /** Signing secret. At least 32 characters; the env schema enforces it. */
  readonly secret: string;
  /** Origin the auth endpoints are served from. */
  readonly baseUrl: string;
  /** Browser origins allowed to carry a session cookie. Never `*`. */
  readonly trustedOrigins: readonly string[];
  readonly isProduction: boolean;
  /**
   * Redis connection used as secondary storage. Sessions and rate-limit
   * counters live there so an API replica does not have to hit PostgreSQL to
   * answer "who is this", and so the limit is shared across replicas rather
   * than being per-process.
   */
  readonly redis?: RedisLike | undefined;
  /** Enables the seeded demo account's sign-in path. Never true in production. */
  readonly allowDemoAccount: boolean;
}

/**
 * The subset of ioredis this package needs.
 *
 * Declared structurally so the package does not depend on a Redis client
 * implementation, and so a test can pass an in-memory fake.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** Role slugs as Better Auth stores them. */
export const ROLE_SLUGS = { user: 'user', admin: 'admin' } as const;

/**
 * Session lifetimes.
 *
 * `expiresIn` bounds how long a stolen cookie stays useful; `updateAge` is how
 * often an active session is refreshed, which is what stops a user being signed
 * out mid-week while still letting an abandoned session expire.
 */
export const SESSION_LIFETIME = {
  expiresInSeconds: 60 * 60 * 24 * 7,
  updateAgeSeconds: 60 * 60 * 24,
  /**
   * How long a signed session snapshot may be trusted from the cookie without
   * a database read. Short, because revoking a session must take effect
   * quickly — this is the window in which a revoked session still works.
   */
  cookieCacheSeconds: 60,
  /** Window in which a session counts as "fresh" for sensitive operations. */
  freshAgeSeconds: 60 * 60 * 24,
} as const;

/**
 * Rate limits for authentication endpoints.
 *
 * Better Auth applies its own stricter built-in rules on top of these; the
 * values here are the outer bound. Credential stuffing is the threat being
 * priced out, so sign-in and password reset are far tighter than the rest.
 */
export const AUTH_RATE_LIMITS = {
  window: 60,
  max: 60,
  rules: {
    '/sign-in/email': { window: 60, max: 5 },
    '/sign-up/email': { window: 300, max: 3 },
    '/forget-password': { window: 300, max: 3 },
    '/reset-password': { window: 300, max: 5 },
    '/change-password': { window: 300, max: 5 },
  },
} as const;

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
} as const;

/** Maps a stored role slug onto the domain role, defaulting to least privilege. */
export function roleFromSlug(slug: string | null | undefined): UserRole {
  return slug?.toLowerCase() === ROLE_SLUGS.admin ? 'ADMIN' : 'USER';
}

export function slugFromRole(role: UserRole): string {
  return role === 'ADMIN' ? ROLE_SLUGS.admin : ROLE_SLUGS.user;
}
