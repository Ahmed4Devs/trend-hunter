'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/locale';

/**
 * Records the reader's language choice.
 *
 * A Server Action rather than a client-side cookie write, because the locale
 * decides what the *server* renders: setting it in the browser would leave the
 * already-rendered server output in the previous language until the next full
 * load, and the `dir` attribute with it.
 *
 * The value is validated rather than trusted. It arrives from the browser, and
 * an unchecked value would be written into a cookie that later selects a
 * message file.
 */
export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    // Deliberately readable by the browser: it carries a display preference,
    // nothing authenticating. httpOnly would only stop the client from knowing
    // which language it is already showing.
    httpOnly: false,
  });

  // Every route renders text, so every route is stale after this.
  revalidatePath('/', 'layout');
}
