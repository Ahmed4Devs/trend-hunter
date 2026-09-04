import type { ApiErrorCode } from '@trendhunter/types';

/**
 * The application error hierarchy.
 *
 * Two properties matter at the transport boundary:
 *
 * - `code` maps deterministically to an HTTP status, so route handlers never
 *   hand-pick status codes;
 * - `expose` says whether `message` is safe to send to a client. Anything
 *   unexpected is reported as a generic internal error and the real cause stays
 *   in the server logs.
 */

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UPSTREAM_UNAVAILABLE: 502,
  FEATURE_DISABLED: 503,
  INTERNAL_ERROR: 500,
};

export function httpStatusForErrorCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

export interface AppErrorOptions {
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  /**
   * Whether `message` may be returned to the client. Defaults to `true` for
   * every code except `INTERNAL_ERROR`.
   */
  readonly expose?: boolean;
}

/** Base class for every error the application raises deliberately. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly expose: boolean;

  constructor(code: ApiErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = options.details;
    this.expose = options.expose ?? code !== 'INTERNAL_ERROR';
    Error.captureStackTrace(this, new.target);
  }

  /** The client-facing projection. Never includes a stack or a cause. */
  toClientPayload(requestId?: string): {
    code: ApiErrorCode;
    message: string;
    details?: Readonly<Record<string, unknown>>;
    requestId?: string;
  } {
    return {
      code: this.code,
      message: this.expose ? this.message : 'An unexpected error occurred.',
      ...(this.expose && this.details ? { details: this.details } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request payload is invalid.', options?: AppErrorOptions) {
    super('VALIDATION_ERROR', message, options);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.', options?: AppErrorOptions) {
    super('UNAUTHENTICATED', message, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource.', options?: AppErrorOptions) {
    super('FORBIDDEN', message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', options?: AppErrorOptions) {
    super('NOT_FOUND', `${resource} was not found.`, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource already exists.', options?: AppErrorOptions) {
    super('CONFLICT', message, options);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please retry later.', options?: AppErrorOptions) {
    super('RATE_LIMITED', message, options);
  }
}

export class FeatureDisabledError extends AppError {
  constructor(feature: string, options?: AppErrorOptions) {
    super('FEATURE_DISABLED', `${feature} is not available in this environment.`, options);
  }
}

/** Raised when an external provider fails or answers with an unusable payload. */
export class UpstreamError extends AppError {
  readonly provider: string;

  constructor(provider: string, message: string, options?: AppErrorOptions) {
    super('UPSTREAM_UNAVAILABLE', message, options);
    this.provider = provider;
  }
}

/** Raised when an LLM answers with something that fails schema validation. */
export class LlmProviderError extends UpstreamError {}

/**
 * Normalises anything thrown into an {@link AppError}. Unknown values become a
 * non-exposed internal error so their message can never reach a client.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message, { cause: error, expose: false });
  }
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', {
    cause: error,
    expose: false,
  });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
