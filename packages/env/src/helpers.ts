import { z } from 'zod';

/**
 * Building blocks shared by every environment schema.
 *
 * Environment variables are the one input that is *always* attacker-adjacent in
 * a container deployment — a mistyped value silently changes security posture —
 * so they are parsed, not read.
 */

/** Booleans arrive as strings; accept the forms operators actually type. */
export const booleanFromEnv = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']))
  .transform((value) => value === 'true' || value === '1' || value === 'yes' || value === 'on');

export const integerFromEnv = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+$/u, 'must be an integer')
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().min(min).max(max));

/** Comma-separated list, trimmed, with empty entries dropped. */
export const listFromEnv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string()));

export const urlFromEnv = z
  .url('must be an absolute URL')
  .trim()
  .refine((value) => !value.endsWith('/') || value === new URL(value).origin + '/', {
    message: 'must not contain a trailing path slash',
  })
  .transform((value) => value.replace(/\/$/, ''));

export const postgresUrlFromEnv = z
  .string()
  .trim()
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

export const redisUrlFromEnv = z
  .string()
  .trim()
  .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
    message: 'must be a redis:// or rediss:// connection string',
  });

/**
 * Markers that identify a value as a development placeholder.
 *
 * Production start-up fails when any secret matches one of these. Shipping the
 * example credentials to a public host would otherwise be a single missed
 * environment variable away.
 */
export const DEVELOPMENT_PLACEHOLDER_MARKERS = [
  'mock_',
  'dev_only',
  'change_me',
  'changeme',
  'replace_me',
  'your_',
  'xxxxx',
  'placeholder',
  'example',
  'insecure',
  'test_secret',
] as const;

export function looksLikeDevelopmentPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return DEVELOPMENT_PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * A secret that must be long enough to be worth having, and must not be one of
 * the documented development placeholders when `enforceProduction` is set.
 */
export function secretSchema(options: { minLength: number; enforceProduction: boolean }) {
  let schema = z.string().min(options.minLength, `must be at least ${options.minLength} characters`);
  if (options.enforceProduction) {
    schema = schema.refine((value) => !looksLikeDevelopmentPlaceholder(value), {
      message:
        'looks like a development placeholder; production requires a real, randomly generated secret',
    });
  }
  return schema;
}

/**
 * Formats a Zod error into an operator-friendly report.
 *
 * Only variable names and validation messages are printed — never the offending
 * value, which would put a secret into the logs of a failing container.
 */
export function formatEnvironmentError(error: z.ZodError, service: string): string {
  const lines = error.issues.map((issue) => {
    const variable = issue.path.join('.') || '(root)';
    return `  - ${variable}: ${issue.message}`;
  });
  return [
    `Invalid environment configuration for the ${service} service:`,
    ...lines,
    '',
    'Copy .env.example to .env and provide the missing values.',
  ].join('\n');
}
