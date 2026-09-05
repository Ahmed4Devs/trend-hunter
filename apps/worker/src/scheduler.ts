import {
  COLLECT_QUEUE_BY_SOURCE,
  QUEUE_NAMES,
  type CollectJobPayload,
  type MaintenanceJobPayload,
  type SourceKind,
} from '@trendhunter/types';
import { DEFAULT_COLLECT_LIMIT, WORKER_HEARTBEAT_INTERVAL_SECONDS } from '@trendhunter/shared';
import { Queue } from 'bullmq';

import type { WorkerContainer } from './container';

/**
 * Repeatable jobs.
 *
 * BullMQ 6 replaced the old `repeat` option with job schedulers, which are
 * upserted by id. That matters for deployment: every replica calls this on
 * boot, and because it is an upsert rather than an add, N replicas produce one
 * schedule rather than N duplicate ones.
 *
 * One nuance worth knowing: the next occurrence is only produced when the
 * previous one *starts processing*, so a saturated queue schedules less often
 * than its nominal interval. That is the desired behaviour here — a backed-up
 * collector should not keep piling up more collections.
 */

/**
 * Default cadence per source, in minutes.
 *
 * They differ because the sources do: Hacker News turns over in minutes, an RSS
 * feed publishes a few times a day, and a GitHub release is a weekly event. A
 * uniform interval would either hammer the slow sources or miss the fast ones.
 * An operator can override any of these per source in the database; these are
 * the fallbacks used when a source has no explicit interval.
 */
const DEFAULT_SCAN_INTERVAL_MINUTES: Readonly<Record<SourceKind, number>> = {
  X: 5,
  HACKERNEWS: 5,
  REDDIT: 10,
  RSS: 15,
  GITHUB: 30,
};

export interface SchedulerHandle {
  close(): Promise<void>;
}

export async function registerSchedules(container: WorkerContainer): Promise<SchedulerHandle> {
  const { env, logger, repositories, producerConnection } = container;
  const opened: Queue[] = [];

  const queueFor = (name: string): Queue => {
    const queue = new Queue(name, { connection: producerConnection });
    opened.push(queue);
    return queue;
  };

  const maintenance = queueFor(QUEUE_NAMES.maintenance);

  // The heartbeat is what tells a stopped worker from a quiet one. It runs
  // regardless of ENABLE_SCHEDULED_SCANS, because readiness has to be truthful
  // even in a deployment that only collects on demand.
  await maintenance.upsertJobScheduler(
    'maintenance:heartbeat',
    { every: WORKER_HEARTBEAT_INTERVAL_SECONDS * 1000 },
    {
      name: 'maintenance',
      data: { task: 'heartbeat' } satisfies MaintenanceJobPayload,
      // A missed heartbeat is meaningless once the next one is due, so it is
      // never retried and never kept.
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 5 } },
    },
  );

  await maintenance.upsertJobScheduler(
    'maintenance:prune-raw-items',
    { pattern: '0 30 3 * * *', tz: 'UTC' },
    { name: 'maintenance', data: { task: 'prune-raw-items' } satisfies MaintenanceJobPayload },
  );

  await maintenance.upsertJobScheduler(
    'maintenance:prune-job-runs',
    { pattern: '0 45 3 * * *', tz: 'UTC' },
    { name: 'maintenance', data: { task: 'prune-job-runs' } satisfies MaintenanceJobPayload },
  );

  if (!env.ENABLE_SCHEDULED_SCANS) {
    logger.info('scheduled scans are disabled; only maintenance is scheduled');
    return { close: () => closeAll(opened) };
  }

  const sources = await repositories.sources.listEnabled();
  for (const source of sources) {
    const baseMinutes = source.scanIntervalMinutes || DEFAULT_SCAN_INTERVAL_MINUTES[source.kind];
    // The multiplier exists so a laptop running the demo is not scanning every
    // five minutes; it is 1 in a real deployment.
    const minutes = baseMinutes * env.SCAN_INTERVAL_MULTIPLIER;

    const queue = queueFor(COLLECT_QUEUE_BY_SOURCE[source.kind]);
    await queue.upsertJobScheduler(
      `collect:${source.kind}`,
      { every: minutes * 60_000 },
      {
        name: 'collect',
        // `scanRunId` is null on a scheduled collection: the worker opens its
        // own scan run when the job starts, because a scheduler template is
        // fixed and cannot carry a fresh id per occurrence.
        data: {
          scanRunId: null,
          sourceId: source.id,
          source: source.kind,
          limit: DEFAULT_COLLECT_LIMIT,
          since: null,
        } satisfies CollectJobPayload,
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
      },
    );

    logger.info(
      { source: source.kind, everyMinutes: minutes },
      'registered scheduled collection',
    );
  }

  return { close: () => closeAll(opened) };
}

async function closeAll(queues: readonly Queue[]): Promise<void> {
  await Promise.all(queues.map((queue) => queue.close()));
}
