import type { ApiErrorBody, ApiErrorCode } from '@trendhunter/types';

/**
 * A failure returned by the API.
 *
 * Carries the machine-readable code, not just a message, because the caller's
 * decision differs by code: 401 sends the reader to sign in, 404 renders the
 * not-found page, and everything else surfaces as an error boundary. Matching
 * on a message string would break the moment the message is translated.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }

  get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED';
  }

  get isNotFound(): boolean {
    return this.code === 'NOT_FOUND';
  }
}

/**
 * A transport failure: the API could not be reached, or answered with something
 * that is not the documented envelope.
 *
 * Distinct from `ApiError` so the UI can say "the service is unavailable"
 * rather than showing a parse failure to a reader.
 */
export class ApiUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiUnreachableError';
  }
}
