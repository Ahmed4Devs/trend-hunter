import type { ReactNode } from 'react';

/**
 * The unauthenticated layout.
 *
 * Deliberately shares nothing with the application shell: no sidebar, no top
 * bar, no user menu. A sign-in page that renders navigation is a sign-in page
 * that has already leaked what the product contains.
 */
export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
