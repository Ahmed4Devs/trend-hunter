import { ValidationError } from '@trendhunter/shared';
import type { z } from 'zod';

export * from './primitives';
export * from './requests';
export * from './queues';

/**
 * `@trendhunter/validation` — the runtime contracts for everything that crosses
 * a trust boundary: HTTP requests, queue payloads and provider responses.
 *
 * The rule the whole codebase follows is that external data is `unknown` until
 * one of these schemas has parsed it. Nothing is cast.
 */

/** Flattens Zod issues into `{ 'body.field': ['message'] }` for the client. */
export function formatIssues(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_';
    (details[path] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Parses untrusted input, raising the application's own `ValidationError` with
 * safe, structured details rather than letting a raw `ZodError` escape.
 */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message = 'The request payload is invalid.',
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(message, { details: formatIssues(result.error) });
  }
  return result.data;
}
