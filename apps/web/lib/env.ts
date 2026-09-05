/* eslint-disable no-restricted-properties --
 * The one place in the app allowed to touch `process.env`.
 *
 * Next replaces `process.env.NEXT_PUBLIC_*` at build time only where the
 * property is written out literally; handing the whole object to a loader would
 * leave the client bundle with an empty object at runtime. So each variable is
 * named explicitly here, and every other module imports the parsed result. */
import { loadWebEnvironment } from '@trendhunter/env';

/**
 * The web application's configuration.
 *
 * Parsed once, at module scope, so a missing or malformed value fails the build
 * or the first render rather than surfacing as `undefined` inside a fetch URL.
 * Only `NEXT_PUBLIC_*` values reach the browser; `API_INTERNAL_URL` is read on
 * the server and is `undefined` in a client bundle, which is why the server
 * accessor below is a function rather than an exported constant.
 */
export const env = loadWebEnvironment({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
});

/**
 * The API origin a Server Component should call.
 *
 * In Docker the browser reaches the API through the published host name while
 * the web container reaches it over the compose network, so the two differ;
 * `API_INTERNAL_URL` overrides when set and the public URL is the fallback.
 */
export function serverApiUrl(): string {
  return env.API_INTERNAL_URL ?? env.NEXT_PUBLIC_API_URL;
}
