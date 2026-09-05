import { getRequestConfig } from 'next-intl/server';

import { resolveLocale } from '@/lib/locale.server';
import { loadMessages } from '@/lib/messages';

/**
 * Per-request internationalisation.
 *
 * The locale comes from a cookie rather than a URL segment. This is a private
 * dashboard behind a session — there is nothing to index and no link to share
 * in a specific language — so a `[locale]` segment would duplicate every route
 * and every redirect to buy nothing.
 */
export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: await loadMessages(locale),
    // Fixed to the deployment's timezone rather than the visitor's. Every
    // timestamp in the product describes when something was collected, and two
    // people comparing the same scan must see the same clock.
    timeZone: 'UTC',
  };
});
