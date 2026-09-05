import { ForbiddenError, UnauthenticatedError } from '@trendhunter/shared';
import type { AuthenticatedUser, UserRole } from '@trendhunter/types';
import { fromNodeHeaders } from 'better-auth/node';

import type { Auth } from './auth';
import { roleFromSlug } from './config';

/**
 * Authorization helpers.
 *
 * Authentication is not authorization. Every protected operation calls one of
 * these, and they are centralised here so that a policy change is a change in
 * one file rather than an audit of every route.
 *
 * They throw rather than return a boolean on purpose: a helper that returns
 * `false` can be called and its result ignored, and that mistake is invisible
 * in review. A throwing guard cannot be accidentally passed.
 */

/** Node's raw header bag, as Fastify exposes it. */
export type RawHeaders = Record<string, string | string[] | undefined>;

export interface SessionContext {
  readonly user: AuthenticatedUser;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

/**
 * Resolves the session behind a request, or `null` when there is none.
 *
 * Never throws for an anonymous request: some endpoints legitimately serve both
 * signed-in and anonymous callers, and they distinguish the two themselves.
 */
export async function resolveSession(
  auth: Auth,
  headers: RawHeaders,
): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (session === null) return null;

  // A banned user keeps a valid cookie until it expires, so the ban is enforced
  // on every request rather than only at sign-in.
  if (session.user.banned === true) return null;

  return {
    user: toAuthenticatedUser(session.user),
    sessionId: session.session.id,
    expiresAt: new Date(session.session.expiresAt),
  };
}

/** Requires a signed-in user. */
export function requireUser(session: SessionContext | null): SessionContext {
  if (session === null) throw new UnauthenticatedError();
  return session;
}

/** Requires a signed-in administrator. */
export function requireAdmin(session: SessionContext | null): SessionContext {
  const authenticated = requireUser(session);
  if (authenticated.user.role !== 'ADMIN') {
    throw new ForbiddenError('This operation requires an administrator.');
  }
  return authenticated;
}

/** Requires one of the given roles. */
export function requireRole(
  session: SessionContext | null,
  ...roles: readonly UserRole[]
): SessionContext {
  const authenticated = requireUser(session);
  if (!roles.includes(authenticated.user.role)) {
    throw new ForbiddenError('You do not have access to this resource.');
  }
  return authenticated;
}

/**
 * Requires that the signed-in user owns the resource.
 *
 * `ownerId` comes from the row that was loaded, never from the request, so a
 * caller cannot assert ownership of something it does not own. Administrators
 * do NOT bypass this: user content — drafts, translations, saved items — is not
 * an administrator's to read, and an admin flag should not become a way to read
 * everyone's private work.
 */
export function requireOwnership(
  session: SessionContext | null,
  ownerId: string | null | undefined,
): SessionContext {
  const authenticated = requireUser(session);
  if (ownerId === null || ownerId === undefined || ownerId !== authenticated.user.id) {
    // Reported as not-found rather than forbidden: confirming that an id exists
    // but belongs to someone else is itself a disclosure.
    throw new ForbiddenError('You do not have access to this resource.');
  }
  return authenticated;
}

/** Projects a Better Auth user onto the domain shape. */
export function toAuthenticatedUser(user: {
  id: string;
  email: string;
  name: string;
  image?: string | null | undefined;
  emailVerified: boolean;
  createdAt: Date | string;
  role?: string | null | undefined;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    role: roleFromSlug(user.role),
    emailVerified: user.emailVerified,
    createdAt:
      typeof user.createdAt === 'string' ? user.createdAt : user.createdAt.toISOString(),
  };
}
