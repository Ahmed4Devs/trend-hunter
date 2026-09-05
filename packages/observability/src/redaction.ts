/**
 * Log redaction policy.
 *
 * Pino redaction is the last line of defence between a credential and a log
 * aggregator. The paths below are deliberately over-broad: redacting a field
 * that turned out to be harmless costs nothing, while missing one puts a
 * session token in a log file that is then shipped, indexed and retained.
 *
 * Paths are matched against the *shape of the logged object*, not against the
 * process environment, so anything merged into a log line has to be listed here
 * explicitly.
 */

/** Field names that must never appear in a log, wherever they occur. */
const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwd',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'secret',
  'clientSecret',
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'sessionToken',
  'session_token',
  'authorization',
  'cookie',
  'setCookie',
  'set-cookie',
  'DATABASE_URL',
  'REDIS_URL',
  'BETTER_AUTH_SECRET',
  'LLM_API_KEY',
  'X_API_BEARER_TOKEN',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'GITHUB_TOKEN',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
] as const;

/** Object roots under which a sensitive field is likely to appear. */
const SENSITIVE_CONTAINERS = [
  'req.headers',
  'request.headers',
  'res.headers',
  'response.headers',
  'headers',
  'body',
  'payload',
  'query',
  'params',
  'config',
  'env',
  'credentials',
  'user',
  'session',
  'account',
  'job.data',
  'err.config',
  'error.config',
] as const;

/**
 * Builds the Pino `redact.paths` list.
 *
 * Covers each sensitive name at the top level, one level under every likely
 * container, and under any array element of those containers.
 */
export function buildRedactionPaths(): string[] {
  const paths = new Set<string>();

  for (const field of SENSITIVE_FIELD_NAMES) {
    paths.add(field);
    paths.add(`*.${field}`);
    for (const container of SENSITIVE_CONTAINERS) {
      paths.add(`${container}.${field}`);
      paths.add(`${container}[*].${field}`);
    }
  }

  // Headers arrive with unpredictable casing from Node's HTTP parser.
  for (const container of ['req.headers', 'request.headers', 'headers']) {
    paths.add(`${container}.authorization`);
    paths.add(`${container}.Authorization`);
    paths.add(`${container}.cookie`);
    paths.add(`${container}.Cookie`);
    paths.add(`${container}["set-cookie"]`);
    paths.add(`${container}["x-api-key"]`);
    paths.add(`${container}["x-auth-token"]`);
    paths.add(`${container}["proxy-authorization"]`);
  }

  return [...paths];
}

/** Replacement written in place of a redacted value. */
export const REDACTION_CENSOR = '[redacted]';

/**
 * Masks the credentials inside a connection string so it can be logged.
 *
 * The result is assembled by hand rather than through `URL.toString()`, which
 * percent-encodes the censor in the userinfo section and turns it into
 * `%5Bredacted%5D` — technically safe, but unreadable in a log line.
 *
 * Returns the bare censor when the value cannot be parsed: a half-parsed URL is
 * exactly the case where a password would otherwise slip through.
 */
export function maskConnectionString(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return REDACTION_CENSOR;
  }

  const hasCredentials = url.username !== '' || url.password !== '';
  const userinfo = hasCredentials ? `${REDACTION_CENSOR}:${REDACTION_CENSOR}@` : '';
  const port = url.port === '' ? '' : `:${url.port}`;
  return `${url.protocol}//${userinfo}${url.hostname}${port}${url.pathname}`;
}
