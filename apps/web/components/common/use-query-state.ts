'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

export interface QueryStateApi {
  readonly params: URLSearchParams;
  /** True while the server is re-rendering for the new parameters. */
  readonly pending: boolean;
  /**
   * Writes parameters and navigates.
   *
   * A `null` value removes the parameter; anything that changes the result set
   * also resets the page, because staying on page 7 of a list that now has two
   * pages shows an empty table and looks like a bug.
   */
  setParams: (next: Readonly<Record<string, string | null>>, options?: { resetPage?: boolean }) => void;
}

/**
 * List state that lives in the URL.
 *
 * `replace`, not `push`: typing in a filter box would otherwise fill the
 * history with one entry per keystroke and make the back button useless. The
 * navigation runs in a transition so the current results stay on screen and
 * interactive while the server produces the new ones.
 */
export function useQueryState(): QueryStateApi {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParams = useCallback(
    (next: Readonly<Record<string, string | null>>, options?: { resetPage?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      if (options?.resetPage !== false) params.delete('page');

      const query = params.toString();
      startTransition(() => {
        router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return { params: searchParams, pending, setParams };
}
