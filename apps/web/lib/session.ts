import type { AuthenticatedUser } from '@trendhunter/types';
import { redirect } from 'next/navigation';

import { apiData } from './api/server';
import { ApiError } from './api/errors';

/**
 * Who the caller is, according to the API.
 *
 * The web application deliberately owns no session logic. It asks the service
 * that issued the cookie, which means there is one definition of "signed in"
 * and one place a revoked session takes effect — a second, local check would
 * eventually disagree with the first, and the interface would render for a user
 * every request then rejects.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    return await apiData<AuthenticatedUser>('/settings/me');
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) return null;
    throw error;
  }
}

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * Used by the dashboard layout. The proxy already turns away a request with no
 * session cookie; this is the check that survives a cookie that exists but is
 * expired, revoked, or belongs to a banned account — none of which the proxy
 * can tell apart from a valid one without asking.
 */
export async function requireCurrentUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (user === null) redirect('/sign-in');
  return user;
}
