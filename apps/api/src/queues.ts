import {
  COLLECT_QUEUE_BY_SOURCE,
  QUEUE_NAMES,
  type CollectJobPayload,
  type ContentGenerationJobPayload,
  type QueueName,
  type ReportGenerationJobPayload,
  type SourceKind,
  type TranslationJobPayload,
} from '@trendhunter/types';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

/**
 * Queue producers.
 *
 * The API only ever *enqueues*. Collectors, embeddings and AI generation are
 * slow, rate-limited and retryable, which is precisely what a queue is for —
 * running any of them inside an HTTP request would hold a connection for
 * minutes and lose the work if the client disconnected.
 *
 * Payloads carry identifiers only. Redis is not a document store, and a payload
 * holding ids stays correct if the row changes between enqueue and execution.
 */

/** Retry policy shared by every job this API enqueues. */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  // Keep a bounded history: enough to explain a failure, not enough to fill
  // Redis. The job_runs table is the durable record.
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 24 * 3_600, count: 1_000 },
} as const;

export interface QueueProducers {
  /**
   * Enqueues a collection job per source for a scan.
   *
   * The job id is derived from the scan and the source, so a retried HTTP
   * request or a double-clicked button cannot enqueue the same collection
   * twice — BullMQ ignores an add with an id it already holds.
   */
  enqueueScan(input: {
    scanRunId: string;
    sources: readonly { id: string; kind: SourceKind }[];
    limit: number;
    since: Date | null;
  }): Promise<void>;

  enqueueTranslation(payload: TranslationJobPayload): Promise<string>;
  enqueueContentGeneration(payload: ContentGenerationJobPayload): Promise<string>;
  enqueueReport(payload: ReportGenerationJobPayload): Promise<string>;

  /** Depth of every queue, for the health widget. */
  counts(): Promise<{ queue: QueueName; waiting: number; active: number; failed: number }[]>;

  close(): Promise<void>;
}

export function createQueueProducers(connection: Redis): QueueProducers {
  const queues = new Map<QueueName, Queue>();

  const queueFor = (name: QueueName): Queue => {
    const existing = queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, queue);
    return queue;
  };

  return {
    async enqueueScan(input) {
      await Promise.all(
        input.sources.map((source) => {
          const payload: CollectJobPayload = {
            scanRunId: input.scanRunId,
            sourceId: source.id,
            source: source.kind,
            limit: input.limit,
            since: input.since === null ? null : input.since.toISOString(),
          };
          return queueFor(COLLECT_QUEUE_BY_SOURCE[source.kind]).add('collect', payload, {
            // Hyphens, not colons. BullMQ builds its own Redis keys with a
            // colon and rejects a custom id containing one — at run time, on
            // the request, which is what made "Scan now" fail with a 500 while
            // every unit test passed.
            jobId: `${input.scanRunId}-${source.kind}`,
          });
        }),
      );
    },

    async enqueueTranslation(payload) {
      // Deduplicated on the target and mode: asking twice for the same
      // translation while the first is still queued is one job, not two calls
      // to a paid provider.
      const job = await queueFor(QUEUE_NAMES.translation).add('translate', payload, {
        // Hyphen-separated for the same reason as the collect ids above.
        jobId: `${payload.targetKind}-${payload.targetId}-${payload.mode}-${payload.targetLanguage}`,
      });
      return job.id ?? '';
    },

    async enqueueContentGeneration(payload) {
      const job = await queueFor(QUEUE_NAMES.contentGeneration).add('generate', payload);
      return job.id ?? '';
    },

    async enqueueReport(payload) {
      const job = await queueFor(QUEUE_NAMES.reportGeneration).add('report', payload, {
        jobId: payload.reportId,
      });
      return job.id ?? '';
    },

    async counts() {
      const names = Object.values(QUEUE_NAMES);
      return Promise.all(
        names.map(async (name) => {
          const counts = await queueFor(name).getJobCounts('waiting', 'active', 'failed');
          return {
            queue: name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            failed: counts.failed ?? 0,
          };
        }),
      );
    },

    async close() {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      queues.clear();
    },
  };
}
