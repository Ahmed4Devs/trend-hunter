import { AppError, UpstreamError } from '@trendhunter/shared';

/**
 * Failure modes of the embedding layer.
 *
 * They are separated because they mean very different things operationally: an
 * unusable provider payload is an upstream incident, whereas a mis-sized vector
 * handed to the pgvector helpers is our own bug and must never be shown to a
 * client.
 */

/**
 * Raised when a provider answers with something that cannot be stored.
 *
 * Never retried: a wrong width or a `NaN` component means the provider is
 * misconfigured (usually the wrong model), and writing it would corrupt the
 * pgvector index rather than merely lose one document.
 */
export class InvalidEmbeddingError extends UpstreamError {}

/** Raised when a vector does not have the width the column expects. */
export class VectorDimensionError extends AppError {
  readonly expected: number;
  readonly received: number;

  constructor(expected: number, received: number) {
    super('INTERNAL_ERROR', `Expected a ${expected}-dimension vector but received ${received}.`, {
      expose: false,
      details: { expected, received },
    });
    this.expected = expected;
    this.received = received;
  }
}

/** Raised when pgvector text cannot be parsed back into numbers. */
export class VectorLiteralError extends AppError {
  constructor(message: string) {
    super('INTERNAL_ERROR', message, { expose: false });
  }
}
