import type { Logger } from '@trendhunter/observability';
import {
  DEFAULT_COLLECT_LIMIT,
  MAX_COLLECT_LIMIT,
  UpstreamError,
  toAppError,
} from '@trendhunter/shared';
import type {
  CollectedItem,
  CollectOptions,
  CollectResult,
  ContentConnector,
  SourceKind,
} from '@trendhunter/types';
import type { ZodType } from 'zod';

/**
 * Shared connector plumbing.
 *
 * Everything a connector must get right regardless of provider lives here:
 * bounding the result set, honouring cancellation, counting provider requests
 * for usage accounting, and collecting the non-fatal problems that belong in
 * the scan history rather than in an exception. A provider adapter is then only
 * responsible for the part that is genuinely provider-specific.
 */

/** Warnings past this point are dropped; a scan record is not a log file. */
const MAX_WARNINGS = 20;

/** Longest warning kept, so a provider error body cannot bloat a scan record. */
const MAX_WARNING_LENGTH = 300;

/**
 * Per-call mutable state.
 *
 * Passed to the adapter rather than kept on the connector, because a connector
 * instance is reused across scans and any state on it would leak between them.
 */
export class CollectionContext {
  readonly source: SourceKind;
  /** Already bounded: never above {@link MAX_COLLECT_LIMIT}, never below one. */
  readonly limit: number;
  readonly since: Date | undefined;
  readonly config: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal | undefined;
  /** The instant the call started; every collected item is stamped with it. */
  readonly collectedAt: Date;

  #warnings: string[] = [];
  #requestCount = 0;
  #droppedWarnings = 0;

  constructor(source: SourceKind, options: CollectOptions, collectedAt: Date) {
    this.source = source;
    this.limit = resolveLimit(options.limit);
    this.since = options.since;
    this.config = options.config;
    this.signal = options.signal;
    this.collectedAt = collectedAt;
  }

  get requestCount(): number {
    return this.#requestCount;
  }

  get warnings(): readonly string[] {
    if (this.#droppedWarnings === 0) return this.#warnings;
    return [...this.#warnings, `${String(this.#droppedWarnings)} further warnings were dropped.`];
  }

  countRequest(count = 1): void {
    this.#requestCount += Math.max(0, Math.floor(count));
  }

  /** Records a non-fatal problem. Duplicates are ignored — retries repeat them. */
  warn(message: string): void {
    const trimmed = message.trim().slice(0, MAX_WARNING_LENGTH);
    if (trimmed.length === 0 || this.#warnings.includes(trimmed)) return;
    if (this.#warnings.length >= MAX_WARNINGS) {
      this.#droppedWarnings += 1;
      return;
    }
    this.#warnings.push(trimmed);
  }

  /** Throws the caller's abort reason when the surrounding job was cancelled. */
  throwIfAborted(): void {
    this.signal?.throwIfAborted();
  }

  /** How many more items are still wanted; adapters use it to stop paging. */
  remaining(collected: number): number {
    return Math.max(0, this.limit - Math.max(0, collected));
  }

  /** True once enough items have been gathered to satisfy the call. */
  isSatisfied(collected: number): boolean {
    return this.remaining(collected) === 0;
  }
}

/**
 * Bounds the requested limit.
 *
 * A caller asking for a million items is a bug somewhere upstream, and a
 * connector that honours it would exhaust memory and the provider's rate limit
 * before anyone noticed.
 */
export function resolveLimit(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_COLLECT_LIMIT;
  return Math.min(MAX_COLLECT_LIMIT, Math.max(1, Math.floor(requested)));
}

export interface ConnectorOptions {
  readonly logger: Logger;
  /**
   * Injected clock. Every connector reads time through it so that mock
   * generation and `since` filtering are reproducible under test.
   */
  readonly now?: () => Date;
}

export interface MockConnectorOptions extends ConnectorOptions {
  /** Seed for the corpus generator. The same seed always yields the same items. */
  readonly seed?: string;
  /** Items generated before the requested limit is applied. */
  readonly volume?: number;
}

export const DEFAULT_MOCK_SEED = 'trendhunter';

/**
 * Generated volume per source.
 *
 * Comfortably above the default collection limit, so the limit genuinely bites
 * and the "most recent first" ordering is exercised rather than assumed.
 */
export const DEFAULT_MOCK_VOLUME = 140;

export abstract class BaseConnector implements ContentConnector {
  abstract readonly source: SourceKind;
  abstract readonly name: string;

  protected readonly logger: Logger;
  protected readonly clock: () => Date;

  constructor(options: ConnectorOptions) {
    this.logger = options.logger;
    this.clock = options.now ?? ((): Date => new Date());
  }

  async collect(options: CollectOptions): Promise<CollectResult> {
    const context = new CollectionContext(this.source, options, this.clock());
    const startedAt = context.collectedAt.getTime();

    let items: readonly CollectedItem[];
    try {
      items = await this.collectItems(context);
    } catch (error) {
      // A cancelled job is not a provider failure and must not be reported as
      // one: the scheduler needs to see the abort to stop retrying.
      if (isAbortError(error)) throw error;
      throw new UpstreamError(this.name, describeFailure(error), { cause: error });
    }

    const bounded = items.length > context.limit ? items.slice(0, context.limit) : items;
    if (bounded.length < items.length) {
      context.warn(
        `Truncated ${String(items.length)} collected items to the requested limit of ${String(context.limit)}.`,
      );
    }

    this.logger.debug(
      {
        connector: this.name,
        collected: bounded.length,
        requests: context.requestCount,
        durationMs: this.clock().getTime() - startedAt,
      },
      'connector collection finished',
    );

    return {
      source: this.source,
      items: bounded,
      requestCount: context.requestCount,
      warnings: context.warnings,
    };
  }

  /** Provider-specific collection. Anything thrown here becomes an upstream error. */
  protected abstract collectItems(context: CollectionContext): Promise<readonly CollectedItem[]>;

  /** Builds a collected item, stamping it with the call's collection instant. */
  protected item(
    context: CollectionContext,
    input: {
      readonly sourceItemId: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly kind: 'post' | 'comment';
      readonly parentSourceItemId?: string;
    },
  ): CollectedItem {
    return {
      source: this.source,
      sourceItemId: input.sourceItemId,
      payload: input.payload,
      kind: input.kind,
      ...(input.parentSourceItemId === undefined
        ? {}
        : { parentSourceItemId: input.parentSourceItemId }),
      collectedAt: context.collectedAt,
    };
  }
}

/**
 * Reads provider configuration out of a {@link CollectionContext}.
 *
 * Source configuration comes from database rows that an operator edits, so it
 * is untrusted in exactly the way a provider response is. A configuration that
 * fails validation degrades the scan to the adapter's defaults and leaves a
 * warning in the scan history; it never fails the collection, because a typo in
 * one source's settings should not stop the others from running.
 */
export function readConnectorConfig<T>(
  context: CollectionContext,
  schema: ZodType<T>,
  fallback: T,
): T {
  const result = schema.safeParse(context.config);
  if (result.success) return result.data;
  context.warn(
    `Source configuration was ignored because it is invalid: ${result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('; ')}`,
  );
  return fallback;
}

/** True for a cancellation, as opposed to a timeout or a provider failure. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * A short, safe description of a failure.
 *
 * Provider errors can carry a request URL with an API key in it, so only the
 * message of a deliberate application error is reused; anything else is
 * reported generically and the real cause travels in `cause` for the logs.
 */
function describeFailure(error: unknown): string {
  const appError = toAppError(error);
  return appError.expose ? appError.message : 'The provider request failed.';
}
