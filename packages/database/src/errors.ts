import { AppError, ConflictError, NotFoundError } from '@trendhunter/shared';

import { Prisma } from './generated/prisma/client';

/**
 * Translates Prisma failures into application errors.
 *
 * Two things must never happen at the transport boundary: a Prisma error class
 * reaching a route handler (which would leak the query, the model names and
 * sometimes the offending values), and a unique-constraint violation being
 * reported as a 500 when it is really a 409.
 *
 * Note on `instanceof`: Prisma 7 exports its error classes from the *generated*
 * client, so two different generated outputs in one process would produce
 * distinct classes. This package owns the only generated client, so the check
 * is safe here — but callers outside it should react to the mapped `AppError`,
 * not re-check Prisma types.
 */

/** Prisma error codes this application handles deliberately. */
const PRISMA_ERROR_CODES = {
  uniqueConstraint: 'P2002',
  foreignKeyConstraint: 'P2003',
  recordNotFound: 'P2025',
  valueTooLong: 'P2000',
  rawQueryFailed: 'P2010',
  timedOut: 'P2024',
} as const;

/** Reads the column list Prisma attaches to a unique-constraint violation. */
function conflictTarget(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null || !('target' in meta)) return null;
  const target = (meta).target;
  if (Array.isArray(target)) {
    return target.filter((entry): entry is string => typeof entry === 'string').join(', ');
  }
  return typeof target === 'string' ? target : null;
}

/**
 * Maps a thrown value to an {@link AppError}.
 *
 * `resource` names the aggregate for the not-found message, e.g. `'Post'`.
 */
export function mapDatabaseError(error: unknown, resource = 'Record'): AppError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case PRISMA_ERROR_CODES.uniqueConstraint: {
        const target = conflictTarget(error.meta);
        return new ConflictError(
          target === null
            ? `${resource} already exists.`
            : `${resource} already exists with the same ${target}.`,
          { cause: error },
        );
      }
      case PRISMA_ERROR_CODES.recordNotFound:
        return new NotFoundError(resource, { cause: error });
      case PRISMA_ERROR_CODES.foreignKeyConstraint:
        return new AppError('VALIDATION_ERROR', 'A referenced record does not exist.', {
          cause: error,
        });
      case PRISMA_ERROR_CODES.valueTooLong:
        return new AppError('VALIDATION_ERROR', 'A submitted value is too long.', { cause: error });
      case PRISMA_ERROR_CODES.timedOut:
        return new AppError('UPSTREAM_UNAVAILABLE', 'The database timed out.', {
          cause: error,
          expose: false,
        });
      default:
        // The message embeds the failing SQL, so it stays server-side.
        return new AppError('INTERNAL_ERROR', `Database error ${error.code}`, {
          cause: error,
          expose: false,
        });
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // A malformed query is a bug in this codebase, never a user error.
    return new AppError('INTERNAL_ERROR', 'Invalid database query.', {
      cause: error,
      expose: false,
    });
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new AppError('UPSTREAM_UNAVAILABLE', 'The database is unavailable.', {
      cause: error,
      expose: false,
    });
  }

  if (error instanceof AppError) return error;

  return new AppError('INTERNAL_ERROR', 'An unexpected database error occurred.', {
    cause: error,
    expose: false,
  });
}

/** Runs a database operation, mapping any failure through {@link mapDatabaseError}. */
export async function withDatabaseErrors<T>(
  resource: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error, resource);
  }
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_ERROR_CODES.uniqueConstraint
  );
}
