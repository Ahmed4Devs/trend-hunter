import type { ContentDraftKind, ContentLanguage, SourceKind, TranslationMode } from './enums';

/**
 * Background job contracts.
 *
 * Queue payloads carry identifiers, never whole domain objects: Redis is not a
 * document store, and a payload that only holds ids stays valid if the row it
 * points at changes between enqueue and execution.
 *
 * The runtime Zod schemas that validate these payloads live in
 * `@trendhunter/validation`; workers must never trust a payload that has not
 * been parsed.
 */

/**
 * Queue names.
 *
 * The product specification writes these with a colon (`collect:x`), but
 * BullMQ 6 rejects a colon in a queue name outright — it is the separator
 * BullMQ uses to build its own Redis keys, so a colon in the name would produce
 * ambiguous keys. The names below keep the same grouping with a hyphen.
 */
export const QUEUE_NAMES = {
  collectX: 'collect-x',
  collectReddit: 'collect-reddit',
  collectHackerNews: 'collect-hackernews',
  collectRss: 'collect-rss',
  collectGithub: 'collect-github',
  normalize: 'normalize',
  embeddings: 'embeddings',
  clustering: 'clustering',
  trendAnalysis: 'trend-analysis',
  translation: 'translation',
  contentGeneration: 'content-generation',
  reportGeneration: 'report-generation',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES) as readonly QueueName[];

/** The five collection queues, as a narrower union than `QueueName`. */
export type CollectQueueName =
  | typeof QUEUE_NAMES.collectX
  | typeof QUEUE_NAMES.collectReddit
  | typeof QUEUE_NAMES.collectHackerNews
  | typeof QUEUE_NAMES.collectRss
  | typeof QUEUE_NAMES.collectGithub;

/**
 * Maps a source to the queue that collects it.
 *
 * Typed with the narrow union rather than `QueueName` so that indexing it
 * yields a collect queue, which is what lets a caller register one handler for
 * all five without the payload widening to every queue's union.
 */
export const COLLECT_QUEUE_BY_SOURCE: Readonly<Record<SourceKind, CollectQueueName>> = {
  X: QUEUE_NAMES.collectX,
  REDDIT: QUEUE_NAMES.collectReddit,
  HACKERNEWS: QUEUE_NAMES.collectHackerNews,
  RSS: QUEUE_NAMES.collectRss,
  GITHUB: QUEUE_NAMES.collectGithub,
};

export interface CollectJobPayload {
  /**
   * The scan this collection belongs to, or `null` for a scheduled run.
   *
   * A job scheduler's template is fixed, so it cannot carry a fresh identifier
   * per occurrence; the worker opens its own scan run when it sees `null`.
   */
  readonly scanRunId: string | null;
  readonly sourceId: string;
  readonly source: SourceKind;
  readonly limit: number;
  /** ISO-8601; only collect items published at or after this instant. */
  readonly since: string | null;
}

export interface NormalizeJobPayload {
  readonly scanRunId: string;
  readonly source: SourceKind;
  readonly rawItemIds: readonly string[];
}

export interface EmbeddingsJobPayload {
  readonly scanRunId: string | null;
  readonly postIds: readonly string[];
  readonly commentIds: readonly string[];
}

export interface ClusteringJobPayload {
  readonly scanRunId: string | null;
  readonly postIds: readonly string[];
}

export interface TrendAnalysisJobPayload {
  readonly scanRunId: string | null;
  /** Empty means "re-evaluate every active topic". */
  readonly topicIds: readonly string[];
}

export interface TranslationJobPayload {
  readonly userId: string;
  readonly targetKind: 'POST' | 'COMMENT' | 'THREAD';
  readonly targetId: string;
  readonly mode: TranslationMode;
  readonly targetLanguage: ContentLanguage;
}

export interface ContentGenerationJobPayload {
  readonly userId: string;
  readonly topicId: string;
  readonly draftKind: ContentDraftKind;
  readonly language: ContentLanguage;
}

export interface ReportGenerationJobPayload {
  readonly userId: string;
  readonly reportId: string;
}

export interface MaintenanceJobPayload {
  readonly task: 'prune-raw-items' | 'prune-job-runs' | 'refresh-source-counters' | 'heartbeat';
}

/** Union used by the worker registry so every queue has a typed processor. */
export interface QueuePayloadMap {
  readonly 'collect-x': CollectJobPayload;
  readonly 'collect-reddit': CollectJobPayload;
  readonly 'collect-hackernews': CollectJobPayload;
  readonly 'collect-rss': CollectJobPayload;
  readonly 'collect-github': CollectJobPayload;
  readonly normalize: NormalizeJobPayload;
  readonly embeddings: EmbeddingsJobPayload;
  readonly clustering: ClusteringJobPayload;
  readonly 'trend-analysis': TrendAnalysisJobPayload;
  readonly translation: TranslationJobPayload;
  readonly 'content-generation': ContentGenerationJobPayload;
  readonly 'report-generation': ReportGenerationJobPayload;
  readonly maintenance: MaintenanceJobPayload;
}
