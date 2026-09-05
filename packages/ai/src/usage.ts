/**
 * In-memory API usage accounting.
 *
 * The API and the worker both call providers on request paths where a database
 * write per call would be pure overhead, so counts accumulate here and are
 * flushed to the `ApiUsage` table on a timer. The recorder is deliberately
 * clock-free: the flusher decides which hour a batch belongs to, which keeps
 * this class trivially testable and stops two services disagreeing about the
 * bucket boundary.
 */

export const LLM_OPERATIONS = ['generate', 'summarize', 'classify', 'translate', 'embed'] as const;
export type LlmOperation = (typeof LLM_OPERATIONS)[number];

export interface ApiUsageEntry {
  readonly provider: string;
  readonly operation: LlmOperation;
  readonly requestCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  /** Accumulated estimated cost in USD; always 0 for the offline provider. */
  readonly estimatedCost: number;
}

export interface RecordUsageInput {
  readonly provider: string;
  readonly operation: LlmOperation;
  readonly success: boolean;
  readonly estimatedCost?: number;
}

interface MutableEntry {
  readonly provider: string;
  readonly operation: LlmOperation;
  requestCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: number;
}

const KEY_SEPARATOR = '::';

export class ApiUsageRecorder {
  readonly #entries = new Map<string, MutableEntry>();

  record(input: RecordUsageInput): void {
    const key = `${input.provider}${KEY_SEPARATOR}${input.operation}`;
    const entry = this.#entries.get(key) ?? {
      provider: input.provider,
      operation: input.operation,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      estimatedCost: 0,
    };

    entry.requestCount += 1;
    if (input.success) entry.successCount += 1;
    else entry.failureCount += 1;

    // A negative or non-finite cost from a misbehaving provider would corrupt
    // the running total for the whole hour, so it is discarded rather than added.
    const cost = input.estimatedCost ?? 0;
    if (Number.isFinite(cost) && cost > 0) entry.estimatedCost += cost;

    this.#entries.set(key, entry);
  }

  recordSuccess(provider: string, operation: LlmOperation, estimatedCost = 0): void {
    this.record({ provider, operation, success: true, estimatedCost });
  }

  recordFailure(provider: string, operation: LlmOperation): void {
    this.record({ provider, operation, success: false });
  }

  /** Distinct provider/operation pairs currently held. */
  get size(): number {
    return this.#entries.size;
  }

  /** A read-only view; the accumulator keeps its counts. */
  snapshot(): ApiUsageEntry[] {
    return [...this.#entries.values()].map((entry) => ({ ...entry }));
  }

  /**
   * Returns everything accumulated and resets.
   *
   * The reset happens before the caller sees the rows, so a flush that fails
   * loses one interval of counts rather than double-counting them on the retry.
   * Usage figures are an operational estimate, and over-reporting cost would be
   * the more misleading failure.
   */
  drain(): ApiUsageEntry[] {
    const drained = this.snapshot();
    this.#entries.clear();
    return drained;
  }

  clear(): void {
    this.#entries.clear();
  }
}

export function isLlmOperation(value: string): value is LlmOperation {
  return (LLM_OPERATIONS as readonly string[]).includes(value);
}
