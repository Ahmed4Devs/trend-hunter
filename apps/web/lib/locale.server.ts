import { cookies } from 'next/headers';

import { env } from './env';
import { isLocale, LOCALE_COOKIE, type Locale } from './locale';

/**
 * The locale for the current request.
 *
 * An unrecognised cookie value falls back to the configured default rather than
 * throwing: the cookie is user-controlled input, and a stale or hand-edited one
 * must not be able to break every page.
 */
export async function resolveLocale(): Promise<Locale> {
  const store = await cookies();
  const cookieValue = store.get(LOCALE_COOKIE)?.value;
  return isLocale(cookieValue) ? cookieValue : env.NEXT_PUBLIC_DEFAULT_LOCALE;
}
