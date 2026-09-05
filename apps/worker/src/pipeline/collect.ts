import { contentHash, DEFAULT_COLLECT_LIMIT, MAX_IDS_PER_JOB } from '@trendhunter/shared';
import { QUEUE_NAMES, type CollectJobPayload } from '@trendhunter/types';

import type { JobContext } from '../runtime/processor';
import { enqueue } from '../runtime/queues';

/**
 * Step 1 of the ingestion pipeline: collection.
 *
 * Provider payloads are stored verbatim in `raw_items` *before* anything is
 * normalised. That ordering is the whole point of the table: when the
 * normalisation rules, the language detection or the scoring change, historical
 * data can be reprocessed from what the provider actually said rather than from
 * our earlier interpretation of it.
 *
 * The step is idempotent. `(source, source_item_id)` is unique, so a retried
 * job re-stores nothing; it still enqueues normalisation for everything it
 * collected, because a previous attempt may have died between the write and the
 * enqueue.
 */
export async function processCollectJob(context: JobContext<CollectJobPayload>): Promise<void> {
  const { payload, logger, signal, container } = context;
  const { connectors, repositories } = container;

  const connector = connectors.get(payload.source);
  if (connector === undefined) {
    throw new Error(`No connector is registered for ${payload.source}.`);
  }

  const source = await repositories.sources.findById(payload.sourceId);
  if (source === null) {
    logger.warn({ sourceId: payload.sourceId }, 'source no longer exists; skipping collection');
    return;
  }
  if (!source.enabled) {
    logger.info({ source: payload.source }, 'source is disabled; skipping collection');
    return;
  }

  // A scheduled collection arrives with no scan run, because a job scheduler's
  // template is fixed. It opens its own so the run still appears in the scan
  // history alongside the manual ones.
  const scanRunId =
    payload.scanRunId ??
    (
      await repositories.operations.createScanRun({
        userId: null,
        trigger: 'SCHEDULED',
        sourceKinds: [payload.source],
      })
    ).id;

  const config = await repositories.sources.loadConfig(source.id);

  const result = await connector.collect({
    limit: payload.limit || DEFAULT_COLLECT_LIMIT,
    ...(payload.since === null ? {} : { since: new Date(payload.since) }),
    config,
    ...(signal === undefined ? {} : { signal }),
  });

  for (const warning of result.warnings) {
    logger.warn({ source: payload.source, warning }, 'connector reported a warning');
  }

  const stored = await repositories.ingestion.storeRawItems(
    result.items.map((item) => ({
      source: item.source,
      sourceItemId: item.sourceItemId,
      payload: item.payload,
      // The kind and the parent are what let normalisation route a comment to
      // the comments table; without them every item is re-read as a post and
      // the comments are silently dropped.
      kind: item.kind === 'comment' ? ('COMMENT' as const) : ('POST' as const),
      parentSourceItemId: item.parentSourceItemId ?? null,
      // Hashed over the serialised payload: two collections of the same item
      // produce the same hash, which is what makes re-collection free.
      contentHash: contentHash(JSON.stringify(item.payload)),
      collectedAt: item.collectedAt,
      scanRunId,
    })),
  );

  await repositories.operations.incrementScanCounters(scanRunId, {
    itemsCollected: result.items.length,
    itemsStored: stored.inserted,
    duplicatesSkipped: stored.duplicates,
  });
  await repositories.sources.markScanned(source.id, new Date());

  // A scheduled run finishes here: there are no other collectors reporting into
  // it, and leaving it RUNNING would make the scan history look permanently
  // stuck.
  if (payload.scanRunId === null) {
    await repositories.operations.finishScanRun(scanRunId, { status: 'COMPLETED' });
  }

  logger.info(
    {
      source: payload.source,
      collected: result.items.length,
      stored: stored.inserted,
      duplicates: stored.duplicates,
      requests: result.requestCount,
    },
    'collection finished',
  );

  // Normalisation is chunked so one enormous collection cannot produce a job
  // whose payload is megabytes of identifiers.
  for (const chunk of chunked(stored.rawItemIds, MAX_IDS_PER_JOB)) {
    await enqueue(container, QUEUE_NAMES.normalize, 'normalize', {
      scanRunId,
      source: payload.source,
      rawItemIds: chunk,
    });
  }
}

export function* chunked<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}
