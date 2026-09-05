import type { Database } from '@trendhunter/database';
import type { UserRole } from '@trendhunter/types';
import { createLocalAccountIssuer } from 'better-auth/db';

import type { Auth } from './auth';
import { slugFromRole } from './config';

/**
 * Account provisioning.
 *
 * Sign-up over HTTP is disabled, so accounts are created here — by the seed
 * script and by an administrator. This goes through Better Auth's own internal
 * adapter rather than writing the tables directly, because the password hash
 * has to be produced by the same code that will later verify it. A hand-rolled
 * hash in a seed script is the classic way to end up with a "correct" account
 * that can never sign in.
 */

export interface ProvisionUserInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly role: UserRole;
  readonly emailVerified?: boolean;
}

export interface ProvisionedUser {
  readonly id: string;
  readonly email: string;
  readonly created: boolean;
}

/**
 * Creates a user, or returns the existing one.
 *
 * Idempotent so the seed can be re-run: an existing account keeps its password
 * rather than being silently reset, which matters if someone changed it.
 */
export async function provisionUser(
  auth: Auth,
  database: Database,
  input: ProvisionUserInput,
): Promise<ProvisionedUser> {
  const email = input.email.trim().toLowerCase();

  const existing = await database.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (existing !== null) {
    return { id: existing.id, email: existing.email, created: false };
  }

  const context = await auth.$context;

  const user = await context.internalAdapter.createUser(
    {
      email,
      name: input.name,
      emailVerified: input.emailVerified ?? true,
      role: slugFromRole(input.role),
    },
    // Declares how the account came to exist, for Better Auth's own hooks.
    // `admin` is accurate: this is operator provisioning, not a self-service
    // sign-up — which is disabled.
    { method: 'admin' },
  );

  // The credential account is a separate row. Without it the user exists but
  // has nothing to authenticate against, which presents as "invalid password"
  // rather than as the missing record it actually is.
  await context.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'credential',
    // Better Auth 1.7 added `issuer`, and sign-in matches on it exactly. It is
    // not the provider id: `createLocalAccountIssuer` namespaces it, so the
    // stored value is `local:credential`. Writing the bare provider id produces
    // an account that looks complete in the database and is invisible to
    // sign-in — which fails as "user not found", naming the wrong row entirely.
    issuer: createLocalAccountIssuer('credential'),
    accountId: user.id,
    password: await context.password.hash(input.password),
  });

  return { id: user.id, email: user.email, created: true };
}
