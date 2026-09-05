import { createServer } from 'node:http';

import { assertProductionReadiness, loadWorkerEnvironment } from '@trendhunter/env';
import { COLLECT_QUEUE_BY_SOURCE, QUEUE_NAMES, type SourceKind } from '@trendhunter/types';
import closeWithGrace from 'close-with-grace';
import type { Worker } from 'bullmq';

import { createWorkerContainer, flushUsage } from './container';
import {
  processContentGenerationJob,
  processMaintenanceJob,
  processReportGenerationJob,
  processTranslationJob,
} from './pipeline/ai-jobs';
import { processClusteringJob } from './pipeline/clustering';
import { processCollectJob } from './pipeline/collect';
import { processEmbeddingsJob } from './pipeline/embeddings';
import { processNormalizeJob } from './pipeline/normalize';
import { processTrendAnalysisJob } from './pipeline/trend-analysis';
import { registerSchedules } from './scheduler';
import { registerWorker } from './runtime/processor';
import { closeQueues } from './runtime/queues';

/**
 * The background worker.
 *
 * Every queue gets its own BullMQ worker, so a slow provider blocks only its
 * own collection rather than starving the whole pipeline. Concurrency is set
 * per queue for the same reason: collection is IO-bound and network-limited,
 * clustering is CPU-bound and writes a lot, and the AI queues are limited by
 * what a provider will accept.
 */

const USAGE_FLUSH_INTERVAL_MS = 60_000;
const SHUTDOWN_GRACE_MS = 30_000;

const SOURCES: readonly SourceKind[] = ['X', 'REDDIT', 'HACKERNEWS', 'RSS', 'GITHUB'];

async function main(): Promise<void> {
  const env = loadWorkerEnvironment();
  assertProductionReadiness(env);

  const container = createWorkerContainer(env);
  const { logger } = container;

  const workers: Worker[] = [];

  // Collection: one worker per source queue, each with a modest concurrency and
  // a rate limit, because these are the only jobs that touch a third party.
  for (const source of SOURCES) {
    workers.push(
      registerWorker({
        queue: COLLECT_QUEUE_BY_SOURCE[source],
        container,
        handler: processCollectJob,
        concurrency: 2,
        // Generous for the offline connectors and polite for the live ones; a
        // provider-specific limit belongs with the adapter, not here.
        limiter: { max: 30, duration: 60_000 },
        // A collection that pages through a slow feed can exceed the default
        // lock and be requeued while still running.
        lockDurationMs: 120_000,
      }),
    );
  }

  workers.push(
    registerWorker({ queue: QUEUE_NAMES.normalize, container, handler: processNormalizeJob }),
    registerWorker({
      queue: QUEUE_NAMES.embeddings,
      container,
      handler: processEmbeddingsJob,
      // Embedding a batch is one provider call per chunk; keeping this low
      // avoids a burst that a hosted provider would rate-limit.
      concurrency: 2,
      lockDurationMs: 120_000,
    }),
    registerWorker({
      queue: QUEUE_NAMES.clustering,
      container,
      // Deliberately serial. Clustering decides against the topics it can see,
      // and two concurrent jobs would each open a topic for the same story
      // because neither would see the other's.
      concurrency: 1,
      handler: processClusteringJob,
      lockDurationMs: 180_000,
    }),
    registerWorker({
      queue: QUEUE_NAMES.trendAnalysis,
      container,
      concurrency: 1,
      handler: processTrendAnalysisJob,
      lockDurationMs: 180_000,
    }),
    registerWorker({
      queue: QUEUE_NAMES.translation,
      container,
      handler: processTranslationJob,
      concurrency: 2,
      lockDurationMs: 120_000,
    }),
    registerWorker({
      queue: QUEUE_NAMES.contentGeneration,
      container,
      handler: processContentGenerationJob,
      concurrency: 2,
      lockDurationMs: 120_000,
    }),
    registerWorker({
      queue: QUEUE_NAMES.reportGeneration,
      container,
      handler: processReportGenerationJob,
      concurrency: 1,
    }),
    registerWorker({
      queue: QUEUE_NAMES.maintenance,
      container,
      handler: processMaintenanceJob,
      concurrency: 1,
    }),
  );

  const schedules = await registerSchedules(container);

  const usageTimer = setInterval(() => {
    void flushUsage(container.repositories.operations, container.usage, logger);
  }, USAGE_FLUSH_INTERVAL_MS);
  usageTimer.unref();

  // A minimal liveness endpoint so a container orchestrator can restart a
  // wedged worker. Readiness is answered by the API, which reads the heartbeat
  // this process writes to Redis — that is the check that distinguishes a
  // running worker from one that is alive but no longer processing.
  const health = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }
    response.writeHead(404).end();
  });
  health.listen(env.HEALTH_PORT, '0.0.0.0');

  closeWithGrace({ delay: SHUTDOWN_GRACE_MS }, async ({ err, signal }) => {
    if (err) logger.error({ err }, 'shutting down after an unhandled error');
    else logger.info({ signal }, 'shutting down');

    clearInterval(usageTimer);
    health.close();

    // Workers close first and wait for their in-flight jobs, so a job is never
    // abandoned mid-write with its database connection pulled from under it.
    await Promise.all(workers.map((worker) => worker.close()));
    await schedules.close();
    await closeQueues();
    await container.close();
  });

  logger.info(
    {
      queues: workers.length,
      concurrency: env.WORKER_CONCURRENCY,
      dataMode: env.DATA_MODE,
      aiProvider: env.AI_PROVIDER,
      scheduledScans: env.ENABLE_SCHEDULED_SCANS,
    },
    'TrendHunter worker ready',
  );
}

main().catch((error: unknown) => {
  console.error('Failed to start the TrendHunter worker:');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
