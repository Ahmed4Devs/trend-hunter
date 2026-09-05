import { MAX_COLLECT_LIMIT, MAX_IDS_PER_JOB } from '@trendhunter/shared';
import { CONTENT_DRAFT_KINDS, SOURCE_KINDS } from '@trendhunter/types';
import { z } from 'zod';

import {
  contentLanguageSchema,
  idSchema,
  isoDateTimeSchema,
  translationModeSchema,
} from './primitives';

/**
 * Queue payload schemas.
 *
 * A job payload is untrusted input like any other. It was written by a
 * different process, possibly a different deployment of a different version,
 * and it may have been sitting in Redis across a release. Workers parse before
 * they act; they never cast.
 */

const idArraySchema = z.array(idSchema).max(MAX_IDS_PER_JOB);

export const collectJobPayloadSchema = z.object({
  // Nullable: a scheduled collection has no scan run until the worker opens one.
  scanRunId: idSchema.nullable(),
  sourceId: idSchema,
  source: z.enum(SOURCE_KINDS),
  limit: z.number().int().min(1).max(MAX_COLLECT_LIMIT),
  since: isoDateTimeSchema.nullable(),
});

export const normalizeJobPayloadSchema = z.object({
  scanRunId: idSchema,
  source: z.enum(SOURCE_KINDS),
  rawItemIds: idArraySchema.min(1),
});

export const embeddingsJobPayloadSchema = z
  .object({
    scanRunId: idSchema.nullable(),
    postIds: idArraySchema,
    commentIds: idArraySchema,
  })
  .refine(
    (payload) => payload.postIds.length + payload.commentIds.length > 0,
    'must reference at least one record',
  );

export const clusteringJobPayloadSchema = z.object({
  scanRunId: idSchema.nullable(),
  postIds: idArraySchema.min(1),
});

export const trendAnalysisJobPayloadSchema = z.object({
  scanRunId: idSchema.nullable(),
  // Empty means "re-evaluate every active topic".
  topicIds: idArraySchema,
});

export const translationJobPayloadSchema = z.object({
  userId: idSchema,
  targetKind: z.enum(['POST', 'COMMENT', 'THREAD']),
  targetId: idSchema,
  mode: translationModeSchema,
  targetLanguage: contentLanguageSchema,
});

export const contentGenerationJobPayloadSchema = z.object({
  userId: idSchema,
  topicId: idSchema,
  draftKind: z.enum(CONTENT_DRAFT_KINDS),
  language: contentLanguageSchema,
});

export const reportGenerationJobPayloadSchema = z.object({
  userId: idSchema,
  reportId: idSchema,
});

export const maintenanceJobPayloadSchema = z.object({
  task: z.enum(['prune-raw-items', 'prune-job-runs', 'refresh-source-counters', 'heartbeat']),
});

/** Maps a queue name to the schema that validates its payload. */
export const QUEUE_PAYLOAD_SCHEMAS = {
  'collect-x': collectJobPayloadSchema,
  'collect-reddit': collectJobPayloadSchema,
  'collect-hackernews': collectJobPayloadSchema,
  'collect-rss': collectJobPayloadSchema,
  'collect-github': collectJobPayloadSchema,
  normalize: normalizeJobPayloadSchema,
  embeddings: embeddingsJobPayloadSchema,
  clustering: clusteringJobPayloadSchema,
  'trend-analysis': trendAnalysisJobPayloadSchema,
  translation: translationJobPayloadSchema,
  'content-generation': contentGenerationJobPayloadSchema,
  'report-generation': reportGenerationJobPayloadSchema,
  maintenance: maintenanceJobPayloadSchema,
} as const;

export type QueuePayloadSchemas = typeof QUEUE_PAYLOAD_SCHEMAS;
