import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { requireCurrentUser } from '@/lib/session';

/**
 * Everything behind a session.
 *
 * The user is resolved once here and passed down, rather than fetched by each
 * page: it is the same request either way, and a page that forgot to check
 * would otherwise render for an anonymous caller until its first API call
 * failed.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const user = await requireCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
