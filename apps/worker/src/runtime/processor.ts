import { startTimer } from '@trendhunter/observability';
import type { Logger } from '@trendhunter/observability';
import { toAppError } from '@trendhunter/shared';
import { QUEUE_PAYLOAD_SCHEMAS } from '@trendhunter/validation';
import type { QueueName } from '@trendhunter/types';
import { UnrecoverableError, Worker, type Job, type Processor } from 'bullmq';
import type { z } from 'zod';

import type { WorkerContainer } from '../container';

/**
 * The processor wrapper every queue handler goes through.
 *
 * It does four things that would otherwise be repeated — and eventually
 * forgotten — in every handler:
 *
 *  1. **Parses the payload.** A job was written by a different process,
 *     possibly a different release, and may have sat in Redis across a deploy.
 *     It is untrusted input like any other, so it is parsed, never cast. A
 *     payload that fails validation can never succeed on retry, so it fails
 *     unrecoverably rather than burning three attempts.
 *  2. **Records the attempt** in `job_runs`, so the scan history can explain
 *     which job failed, why, and how long it took.
 *  3. **Times and logs** the run against a child logger carrying the queue,
 *     job id and attempt.
 *  4. **Honours cancellation.** The abort signal fires when the lock is lost or
 *     the worker is shutting down; handlers that do network work pass it on.
 */

export interface JobContext<TPayload> {
  readonly payload: TPayload;
  readonly job: Job;
  readonly logger: Logger;
  /** Aborts when the lock is lost or the worker is stopping. */
  readonly signal: AbortSignal | undefined;
  readonly container: WorkerContainer;
}

/** The validated payload a given queue carries. */
export type JobPayload<TQueue extends QueueName> = z.infer<
  (typeof QUEUE_PAYLOAD_SCHEMAS)[TQueue]
>;

export type JobHandler<TQueue extends QueueName> = (
  context: JobContext<JobPayload<TQueue>>,
) => Promise<void>;

export interface RegisterWorkerOptions<TQueue extends QueueName> {
  readonly queue: TQueue;
  readonly container: WorkerContainer;
  readonly handler: JobHandler<TQueue>;
  readonly concurrency?: number;
  /** Provider-specific throttle, for queues that call an external API. */
  readonly limiter?: { max: number; duration: number };
  /** Long-running jobs need a longer lock than the 30 s default. */
  readonly lockDurationMs?: number;
}

export function registerWorker<TQueue extends QueueName>(
  options: RegisterWorkerOptions<TQueue>,
): Worker {
  const { queue, container, handler } = options;
  const schema = QUEUE_PAYLOAD_SCHEMAS[queue];

  const processor: Processor = async (job, _token, signal) => {
    const logger = container.logger.child({
      queue,
      jobId: job.id ?? 'unknown',
      jobName: job.name,
      attempt: job.attemptsMade + 1,
    });

    const parsed = schema.safeParse(job.data);
    if (!parsed.success) {
      // Retrying cannot change a malformed payload, so this is terminal. Only
      // the issue paths are logged — the payload itself may carry user content.
      logger.error(
        { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        'job payload failed validation',
      );
      throw new UnrecoverableError('The job payload did not match its schema.');
    }

    const timer = startTimer();
    const jobRunId = await container.repositories.operations.startJobRun({
      queue,
      jobName: job.name,
      jobId: job.id ?? `${queue}:${String(job.timestamp)}`,
      scanRunId: readScanRunId(parsed.data),
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    });

    try {
      await handler({
        // `schema` is indexed by an unresolved generic, so TypeScript widens
        // `parsed.data` to the union of every queue's payload and cannot see
        // that it matches this queue's. The value has already been validated
        // against exactly this schema, so the narrowing is sound.
        payload: parsed.data as JobPayload<TQueue>,
        job,
        logger,
        signal,
        container,
      });

      await container.repositories.operations.finishJobRun(jobRunId, {
        status: 'COMPLETED',
        durationMs: timer.elapsedMs(),
      });
      logger.debug({ durationMs: timer.elapsedMs() }, 'job completed');
    } catch (error) {
      const appError = toAppError(error);
      await container.repositories.operations.finishJobRun(jobRunId, {
        status: 'FAILED',
        durationMs: timer.elapsedMs(),
        // The stored reason is the operator-safe message; the full error with
        // its stack goes to the log.
        failureReason: appError.expose ? appError.message : appError.code,
      });
      logger.error({ err: error, durationMs: timer.elapsedMs() }, 'job failed');
      throw error;
    }
  };

  const worker = new Worker(queue, processor, {
    connection: container.consumerConnection,
    concurrency: options.concurrency ?? container.env.WORKER_CONCURRENCY,
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
    lockDuration: options.lockDurationMs ?? 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    removeOnComplete: { age: 3_600, count: 500 },
    removeOnFail: { age: 7 * 24 * 3_600, count: 1_000 },
  });

  worker.on('failed', (job, error) => {
    container.logger.warn(
      { queue, jobId: job?.id, attempt: job?.attemptsMade, err: error },
      'job attempt failed',
    );
  });

  worker.on('stalled', (jobId) => {
    // A stall means the lock expired while the job was still running: either
    // the handler is slower than lockDuration or the process was blocked.
    container.logger.warn({ queue, jobId }, 'job stalled and was requeued');
  });

  worker.on('error', (error) => {
    container.logger.error({ queue, err: error }, 'worker error');
  });

  return worker;
}

/** Reads the scan a payload belongs to, when it belongs to one. */
function readScanRunId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('scanRunId' in payload)) return null;
  const value: unknown = payload.scanRunId;
  return typeof value === 'string' ? value : null;
}
