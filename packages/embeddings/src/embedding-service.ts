import { setTimeout as sleepFor } from 'node:timers/promises';

import { EMBEDDING_INPUT_CHARACTER_LIMIT, ValidationError } from '@trendhunter/shared';
import type { EmbedOutput, EmbeddingProvider } from '@trendhunter/types';

import { InvalidEmbeddingError } from './errors';

/**
 * The seam between the ingestion pipeline and whichever model is configured.
 *
 * The provider is injected, so nothing above this class knows — or can depend
 * on — which vendor is answering. What the class adds on top of a raw provider
 * call is the operational behaviour every caller would otherwise reimplement:
 * batching, input truncation, bounded retries, and a hard validation pass on
 * the returned vectors.
 *
 * That last part is not defensive programming for its own sake. A `NaN` or a
 * short vector written into a pgvector column corrupts the index for every
 * subsequent search, and the failure surfaces far away from its cause, so the
 * value is rejected here rather than persisted.
 */

/**
 * The logging surface used by this package.
 *
 * Declared structurally rather than importing a logger type, so the package has
 * no dependency on the observability stack and tests can pass a recorder. A
 * pino `Logger` satisfies it as-is.
 */
export interface EmbeddingLogger {
  debug(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

/** Texts per provider call. Small enough to stay under vendor payload limits. */
export const DEFAULT_EMBEDDING_BATCH_SIZE = 16;

/** Total attempts per batch, including the first. */
export const DEFAULT_EMBEDDING_MAX_ATTEMPTS = 3;

export const DEFAULT_EMBEDDING_BACKOFF_MS = 250;
export const DEFAULT_EMBEDDING_MAX_BACKOFF_MS = 10_000;

export interface EmbeddingServiceOptions {
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Injected by tests so a retry does not really wait. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * One embedding, or `null` for an input that was skipped because it held no
 * text. Callers index this by the position of the original input.
 */
export type EmbeddingResult = readonly number[] | null;

interface PendingInput {
  readonly index: number;
  readonly text: string;
}

/** Trims and truncates one input, or returns `null` when there is nothing to embed. */
function prepareInput(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  // A hard cut, not a word-boundary truncation: this is a model input budget,
  // not display text, and the leading characters carry the topical signal.
  return trimmed.length > EMBEDDING_INPUT_CHARACTER_LIMIT
    ? trimmed.slice(0, EMBEDDING_INPUT_CHARACTER_LIMIT)
    : trimmed;
}

export class EmbeddingService {
  /** Width every vector this service returns is guaranteed to have. */
  readonly dimensions: number;

  private readonly provider: EmbeddingProvider;
  private readonly logger: EmbeddingLogger;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    provider: EmbeddingProvider,
    logger: EmbeddingLogger,
    options: EmbeddingServiceOptions = {},
  ) {
    this.provider = provider;
    this.logger = logger;
    this.dimensions = provider.dimensions;
    this.batchSize = Math.max(1, Math.trunc(options.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE));
    this.maxAttempts = Math.max(
      1,
      Math.trunc(options.maxAttempts ?? DEFAULT_EMBEDDING_MAX_ATTEMPTS),
    );
    this.initialBackoffMs = Math.max(0, options.initialBackoffMs ?? DEFAULT_EMBEDDING_BACKOFF_MS);
    this.maxBackoffMs = Math.max(
      this.initialBackoffMs,
      options.maxBackoffMs ?? DEFAULT_EMBEDDING_MAX_BACKOFF_MS,
    );
    this.sleep =
      options.sleep ??
      (async (milliseconds) => {
        await sleepFor(milliseconds);
      });
  }

  /**
   * Embeds every text, preserving input order.
   *
   * Blank inputs never reach the provider — they would burn quota and, for a
   * hosted model, come back as an arbitrary vector — but they still occupy
   * their slot in the result, so `result[i]` always belongs to `texts[i]`.
   */
  async embedTexts(texts: readonly string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = Array.from({ length: texts.length }, () => null);
    const pending: PendingInput[] = [];
    for (const [index, text] of texts.entries()) {
      const prepared = prepareInput(text);
      if (prepared !== null) pending.push({ index, text: prepared });
    }
    if (pending.length === 0) return results;

    for (let start = 0; start < pending.length; start += this.batchSize) {
      const batch = pending.slice(start, start + this.batchSize);
      // Sequential on purpose: providers rate-limit per key, and a burst of
      // parallel batches from several workers is what trips those limits.
      const vectors = await this.embedBatch(batch.map((entry) => entry.text));
      for (const [offset, entry] of batch.entries()) {
        results[entry.index] = vectors[offset] ?? null;
      }
    }

    this.logger.debug(
      { provider: this.provider.name, inputs: texts.length, embedded: pending.length },
      'Embedded texts',
    );
    return results;
  }

  /** Embeds a single text. Rejects blank input rather than inventing a vector. */
  async embedOne(text: string): Promise<readonly number[]> {
    const [vector] = await this.embedTexts([text]);
    if (!vector) {
      throw new ValidationError('Cannot embed an empty text.');
    }
    return vector;
  }

  private async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    let attempt = 1;
    for (;;) {
      try {
        const result = await this.provider.embed({ texts });
        return this.validate(result.value, texts.length);
      } catch (error) {
        // An unusable payload is a configuration fault, not a blip: retrying it
        // only multiplies the cost of the same wrong answer.
        if (error instanceof InvalidEmbeddingError || attempt >= this.maxAttempts) throw error;

        const backoffMs = Math.min(this.maxBackoffMs, this.initialBackoffMs * 2 ** (attempt - 1));
        this.logger.warn(
          {
            provider: this.provider.name,
            attempt,
            maxAttempts: this.maxAttempts,
            backoffMs,
            batchSize: texts.length,
            err: error,
          },
          'Embedding batch failed, retrying',
        );
        await this.sleep(backoffMs);
        attempt += 1;
      }
    }
  }

  /**
   * Checks the shape of a provider answer before any of it can be persisted.
   * Anything wrong here means the batch is discarded, not silently repaired.
   */
  private validate(output: EmbedOutput, expectedCount: number): readonly (readonly number[])[] {
    const { vectors } = output;
    if (vectors.length !== expectedCount) {
      throw new InvalidEmbeddingError(
        this.provider.name,
        `Expected ${expectedCount} embeddings but received ${vectors.length}.`,
        { details: { expected: expectedCount, received: vectors.length } },
      );
    }
    if (output.dimensions !== this.dimensions) {
      throw new InvalidEmbeddingError(
        this.provider.name,
        `Provider reported ${output.dimensions} dimensions but is configured for ${this.dimensions}.`,
        { details: { expected: this.dimensions, received: output.dimensions } },
      );
    }

    for (const [index, vector] of vectors.entries()) {
      if (vector.length !== this.dimensions) {
        throw new InvalidEmbeddingError(
          this.provider.name,
          `Embedding ${index} has ${vector.length} dimensions, expected ${this.dimensions}.`,
          { details: { index, expected: this.dimensions, received: vector.length } },
        );
      }
      for (const [component, value] of vector.entries()) {
        if (!Number.isFinite(value)) {
          throw new InvalidEmbeddingError(
            this.provider.name,
            `Embedding ${index} has a non-finite component at position ${component}.`,
            { details: { index, component } },
          );
        }
      }
    }

    return vectors;
  }
}
