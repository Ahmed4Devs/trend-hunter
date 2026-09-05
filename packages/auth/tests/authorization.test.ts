import { ForbiddenError, UnauthenticatedError } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  AUTH_RATE_LIMITS,
  PASSWORD_POLICY,
  roleFromSlug,
  SESSION_LIFETIME,
  slugFromRole,
} from '../src/config';
import {
  requireAdmin,
  requireOwnership,
  requireRole,
  requireUser,
  toAuthenticatedUser,
  type SessionContext,
} from '../src/authorization';

/**
 * Authorization tests.
 *
 * Every case here is an access-control decision, so they are written as
 * assertions about what must be REFUSED. A guard that wrongly allows is a
 * vulnerability; a guard that wrongly refuses is a bug report.
 */

function sessionFor(overrides: Partial<SessionContext['user']> = {}): SessionContext {
  return {
    user: {
      id: 'user-1',
      email: 'analyst@trendhunter.local',
      name: 'Analyst',
      image: null,
      role: 'USER',
      emailVerified: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    },
    sessionId: 'session-1',
    expiresAt: new Date('2026-09-12T00:00:00.000Z'),
  };
}

describe('roleFromSlug', () => {
  it('maps the admin slug to the admin role', () => {
    expect(roleFromSlug('admin')).toBe('ADMIN');
    expect(roleFromSlug('ADMIN')).toBe('ADMIN');
  });

  it('treats anything unrecognised as the least-privileged role', () => {
    // An unknown role must never be read as elevated access — that is how a
    // typo or a future role becomes a privilege escalation.
    for (const slug of ['user', 'editor', 'superuser', 'root', '', null, undefined]) {
      expect(roleFromSlug(slug)).toBe('USER');
    }
  });

  it('round-trips through slugFromRole', () => {
    expect(roleFromSlug(slugFromRole('ADMIN'))).toBe('ADMIN');
    expect(roleFromSlug(slugFromRole('USER'))).toBe('USER');
  });
});

describe('requireUser', () => {
  it('returns the session when one is present', () => {
    const session = sessionFor();
    expect(requireUser(session)).toBe(session);
  });

  it('refuses an anonymous caller with 401', () => {
    expect(() => requireUser(null)).toThrow(UnauthenticatedError);
    try {
      requireUser(null);
    } catch (error) {
      expect((error as UnauthenticatedError).statusCode).toBe(401);
    }
  });
});

describe('requireAdmin', () => {
  it('allows an administrator', () => {
    const session = sessionFor({ role: 'ADMIN' });
    expect(requireAdmin(session)).toBe(session);
  });

  it('refuses an ordinary user with 403', () => {
    try {
      requireAdmin(sessionFor({ role: 'USER' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).statusCode).toBe(403);
    }
  });

  it('refuses an anonymous caller with 401 rather than 403', () => {
    // The distinction matters to the client: 401 means "sign in", 403 means
    // "signing in will not help".
    expect(() => requireAdmin(null)).toThrow(UnauthenticatedError);
  });
});

describe('requireRole', () => {
  it('allows any listed role', () => {
    expect(() => requireRole(sessionFor({ role: 'USER' }), 'USER', 'ADMIN')).not.toThrow();
    expect(() => requireRole(sessionFor({ role: 'ADMIN' }), 'USER', 'ADMIN')).not.toThrow();
  });

  it('refuses a role that is not listed', () => {
    expect(() => requireRole(sessionFor({ role: 'USER' }), 'ADMIN')).toThrow(ForbiddenError);
  });

  it('refuses everything when no role is listed', () => {
    expect(() => requireRole(sessionFor({ role: 'ADMIN' }))).toThrow(ForbiddenError);
  });
});

describe('requireOwnership', () => {
  it('allows the owner', () => {
    const session = sessionFor();
    expect(requireOwnership(session, 'user-1')).toBe(session);
  });

  it('refuses another user', () => {
    expect(() => requireOwnership(sessionFor(), 'user-2')).toThrow(ForbiddenError);
  });

  it('refuses an unowned resource', () => {
    expect(() => requireOwnership(sessionFor(), null)).toThrow(ForbiddenError);
    expect(() => requireOwnership(sessionFor(), undefined)).toThrow(ForbiddenError);
  });

  it('does NOT let an administrator read another user’s content', () => {
    // Deliberate: drafts, translations and saved items are personal work. An
    // admin flag exists to manage the deployment, not to read everyone's notes.
    expect(() => requireOwnership(sessionFor({ role: 'ADMIN' }), 'user-2')).toThrow(ForbiddenError);
  });

  it('refuses an anonymous caller', () => {
    expect(() => requireOwnership(null, 'user-1')).toThrow(UnauthenticatedError);
  });
});

describe('toAuthenticatedUser', () => {
  it('projects a Better Auth user onto the domain shape', () => {
    const user = toAuthenticatedUser({
      id: 'user-9',
      email: 'a@b.test',
      name: 'A B',
      image: null,
      emailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      role: 'admin',
    });

    expect(user).toEqual({
      id: 'user-9',
      email: 'a@b.test',
      name: 'A B',
      image: null,
      role: 'ADMIN',
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('defaults a missing role to the least-privileged one', () => {
    const user = toAuthenticatedUser({
      id: 'user-9',
      email: 'a@b.test',
      name: 'A B',
      emailVerified: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(user.role).toBe('USER');
    expect(user.image).toBeNull();
  });

  it('exposes no credential material', () => {
    const user = toAuthenticatedUser({
      id: 'user-9',
      email: 'a@b.test',
      name: 'A B',
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      role: 'user',
    });
    const serialised = JSON.stringify(user);
    for (const field of ['password', 'hash', 'token', 'secret', 'salt']) {
      expect(serialised.toLowerCase()).not.toContain(field);
    }
  });
});

describe('authentication policy', () => {
  it('requires a password long enough to resist offline cracking', () => {
    expect(PASSWORD_POLICY.minLength).toBeGreaterThanOrEqual(12);
  });

  it('limits sign-in attempts far more tightly than ordinary requests', () => {
    // Credential stuffing is the threat these numbers are priced against.
    expect(AUTH_RATE_LIMITS.rules['/sign-in/email'].max).toBeLessThanOrEqual(5);
    expect(AUTH_RATE_LIMITS.rules['/sign-up/email'].max).toBeLessThanOrEqual(3);
    expect(AUTH_RATE_LIMITS.rules['/forget-password'].max).toBeLessThanOrEqual(3);
  });

  it('keeps the cookie-cache window short enough for revocation to bite', () => {
    // This is the window in which a revoked session still works, so it is the
    // one number here that trades security directly against database load.
    expect(SESSION_LIFETIME.cookieCacheSeconds).toBeLessThanOrEqual(60);
  });

  it('expires sessions within a week', () => {
    expect(SESSION_LIFETIME.expiresInSeconds).toBeLessThanOrEqual(60 * 60 * 24 * 7);
  });
});
