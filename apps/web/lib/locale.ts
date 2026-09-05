/**
 * The locales the interface ships in, and the direction each implies.
 *
 * One module owns both, because they are one decision: a locale set without its
 * direction produces an Arabic interface laid out left to right, which is worse
 * than an untranslated one.
 *
 * Deliberately free of `next/headers`, so a Client Component can import
 * `LOCALES` for a language switcher without dragging a server-only module into
 * the browser bundle. Reading the current request's locale lives next door in
 * `locale.server.ts`.
 */

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Name of the cookie carrying the reader's choice. */
export const LOCALE_COOKIE = 'trendhunter.locale';

/** How long a chosen locale is remembered, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && LOCALES.includes(value as Locale);
}

export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
