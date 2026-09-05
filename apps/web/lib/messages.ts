import type { Locale } from './locale';

/**
 * Loads a locale's messages.
 *
 * A switch over literal imports rather than a template path, so the bundler can
 * see both files: a dynamic `../messages/${locale}.json` compiles, but leaves
 * the bundle to guess, and adding a third locale would then fail at runtime
 * rather than at build time.
 */
export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const messages =
    locale === 'ar' ? await import('../messages/ar.json') : await import('../messages/en.json');
  return messages.default;
}
