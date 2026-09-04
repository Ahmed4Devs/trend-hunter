import { AppError } from './errors';

/**
 * Guards for conditions that indicate a programming error rather than bad
 * input. They throw non-exposed internal errors: the message is for the logs,
 * never for the client.
 */

/** Throws when `condition` is falsy. Narrows the type for the caller. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AppError('INTERNAL_ERROR', `Invariant violated: ${message}`, { expose: false });
  }
}

/**
 * Exhaustiveness guard for discriminated unions. Referencing the `never` type
 * makes the compiler fail if a new variant is added and left unhandled.
 */
export function assertNever(value: never, context = 'value'): never {
  throw new AppError('INTERNAL_ERROR', `Unhandled ${context}: ${JSON.stringify(value)}`, {
    expose: false,
  });
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Narrows a string to one of `allowed`, without casting. */
export function isOneOf<const T extends readonly string[]>(
  value: string,
  allowed: T,
): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}
