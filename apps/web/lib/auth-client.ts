'use client';

import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { env } from './env';

/**
 * The browser's authentication client.
 *
 * Points at the API, not at this application: the session cookie is issued by
 * the API's `/api/auth/*` routes and there is no auth handler in Next. Keeping
 * one issuer means one cookie, one origin allowlist and one place where a
 * session can be revoked.
 *
 * The admin plugin mirrors the server's, so `role` is present on the session
 * user and the interface can hide what a non-administrator cannot do. It is
 * only ever a hint: authorisation is decided by the API on every request.
 */
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_API_URL,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [adminClient()],
});

export const { signIn, signOut, useSession } = authClient;
