import { QUEUE_NAMES, type QueueName, type QueuePayloadMap } from '@trendhunter/types';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import type { WorkerContainer } from '../container';

/**
 * Queue producers for the worker.
 *
 * Each pipeline step enqueues the next one rather than calling it, so a failure
 * in clustering does not roll back a successful collection, and each step
 * retries on its own terms. Chaining through the queue is also what keeps a
 * long ingestion run from holding one lock for its entire duration.
 *
 * A `FlowProducer` would express the same chain as a parent/child tree, but the
 * steps here fan out unevenly — one collection becomes many normalisation jobs,
 * which become a variable number of embedding jobs — and a flow's parent
 * completes only when every descendant does, which would turn one slow provider
 * into a stalled tree. Independent jobs are the better fit.
 */

const queues = new Map<string, Queue>();

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 24 * 3_600, count: 1_000 },
} as const;

function queueFor(connection: Redis, name: QueueName): Queue {
  const key = name;
  const existing = queues.get(key);
  if (existing) return existing;
  const queue = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  queues.set(key, queue);
  return queue;
}

/** Enqueues the next pipeline step. */
export async function enqueue<TQueue extends QueueName>(
  container: WorkerContainer,
  queue: TQueue,
  jobName: string,
  payload: QueuePayloadMap[TQueue],
  options: { jobId?: string; delayMs?: number } = {},
): Promise<void> {
  await queueFor(container.producerConnection, queue).add(jobName, payload, {
    ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
    ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
  });
}

/** Closes every queue this process opened. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}

export { QUEUE_NAMES };
