import type { Logger } from 'pino';

/**
 * Duration measurement.
 *
 * Uses the monotonic clock, not `Date.now()`: a wall-clock jump (NTP step,
 * container clock sync) would otherwise produce negative durations in the
 * middle of a job and poison any latency aggregation built on top.
 */

export interface Timer {
  /** Milliseconds elapsed since the timer was created, rounded to 0.01ms. */
  elapsedMs(): number;
}

export function startTimer(): Timer {
  const startedAt = performance.now();
  return {
    elapsedMs: () => Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

/**
 * Runs an operation, logging its outcome and duration exactly once.
 *
 * The error is re-thrown after logging: this helper observes, it never
 * swallows. Callers stay responsible for handling failure.
 */
export async function withTiming<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
  context: Readonly<Record<string, unknown>> = {},
): Promise<T> {
  const timer = startTimer();
  try {
    const result = await fn();
    logger.debug(
      { ...context, operation, durationMs: timer.elapsedMs() },
      `${operation} completed`,
    );
    return result;
  } catch (error) {
    logger.error(
      { ...context, operation, durationMs: timer.elapsedMs(), err: error },
      `${operation} failed`,
    );
    throw error;
  }
}
