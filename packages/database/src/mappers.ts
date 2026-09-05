import { calculateEngagementScore } from '@trendhunter/ranking';
import { round } from '@trendhunter/shared';
import type {
  ApiUsage,
  ArabicOpportunityBreakdown,
  Comment,
  ContentDraft,
  Interest,
  IsoDateTime,
  JobRun,
  ManualPublication,
  Post,
  RelevanceScoreBreakdown,
  Report,
  SavedItem,
  ScanRun,
  Source,
  SourceDistributionSlice,
  Thread,
  Topic,
  TopicSignalExplanation,
  Translation,
  TrendScoreBreakdown,
  TrendSnapshot,
  UserRole,
  UserSettings,
} from '@trendhunter/types';

import type { Prisma } from './client';

/**
 * Row-to-domain mapping.
 *
 * This is the boundary where persistence stops and the API contract starts.
 * Every repository returns domain objects, never Prisma rows, which is what
 * guarantees three things by construction:
 *
 *  * no column that must not be public (password hashes, embeddings, raw
 *    payload pointers) can reach a response, because there is nowhere here to
 *    put it;
 *  * dates are ISO-8601 strings, so the API never depends on the serialiser;
 *  * `Decimal` and `bigint` values are converted once, here, instead of
 *    surprising a JSON encoder later.
 */

function iso(value: Date): IsoDateTime {
  return value.toISOString();
}

function isoOrNull(value: Date | null): IsoDateTime | null {
  return value === null ? null : value.toISOString();
}

/**
 * Reads a JSON column that should hold a known shape.
 *
 * Returns `null` rather than trusting the value: JSON columns are written by
 * earlier versions of this code and by migrations, so their shape is a
 * historical fact rather than a guarantee. Callers that need certainty parse
 * with Zod; callers that only display it tolerate `null`.
 */
function jsonAs<T>(value: Prisma.JsonValue | null, guard: (input: unknown) => input is T): T | null {
  if (value === null) return null;
  return guard(value) ? value : null;
}

function isTrendBreakdown(value: unknown): value is TrendScoreBreakdown {
  return (
    typeof value === 'object' &&
    value !== null &&
    'components' in value &&
    'trendScore' in value &&
    'saturationPenalty' in value
  );
}

function isRelevanceBreakdown(value: unknown): value is RelevanceScoreBreakdown {
  return (
    typeof value === 'object' &&
    value !== null &&
    'components' in value &&
    'relevanceScore' in value
  );
}

function isArabicOpportunityBreakdown(value: unknown): value is ArabicOpportunityBreakdown {
  return (
    typeof value === 'object' &&
    value !== null &&
    'components' in value &&
    'arabicOpportunityScore' in value
  );
}

function isSignalExplanations(value: unknown): value is TopicSignalExplanation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === 'object' && entry !== null && 'reason' in entry && 'detail' in entry,
    )
  );
}

/**
 * Maps the Better Auth role slug onto the domain role.
 *
 * Better Auth's admin plugin writes lowercase slugs; the rest of the
 * application speaks in the uppercase domain union. Anything unrecognised is
 * treated as the least-privileged role — an unknown role must never be
 * interpreted as elevated access.
 */
export function toUserRole(value: string | null): UserRole {
  return value?.toLowerCase() === 'admin' ? 'ADMIN' : 'USER';
}

export function toDatabaseRole(role: UserRole): string {
  return role === 'ADMIN' ? 'admin' : 'user';
}

// ---------------------------------------------------------------------------
// Selections
//
// Declared once so that every query for an entity reads exactly the columns the
// mapper needs — no more (avoiding needless IO on wide rows) and no fewer.
// ---------------------------------------------------------------------------

export const POST_SELECT = {
  id: true,
  source: true,
  sourcePostId: true,
  authorId: true,
  authorName: true,
  authorUsername: true,
  title: true,
  content: true,
  url: true,
  language: true,
  publishedAt: true,
  collectedAt: true,
  likes: true,
  replies: true,
  reposts: true,
  views: true,
  engagementScore: true,
  relevanceScore: true,
  trendScore: true,
  opportunityScore: true,
  relevanceBreakdown: true,
  isRead: true,
  isSaved: true,
  isHidden: true,
  topicId: true,
  createdAt: true,
  updatedAt: true,
  topic: { select: { name: true } },
  _count: { select: { comments: true, translations: true } },
} as const satisfies Prisma.PostSelect;

export type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

export function toPost(row: PostRow): Post {
  return {
    id: row.id,
    source: row.source,
    sourcePostId: row.sourcePostId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorUsername: row.authorUsername,
    title: row.title,
    content: row.content,
    url: row.url,
    language: row.language,
    publishedAt: iso(row.publishedAt),
    collectedAt: iso(row.collectedAt),
    metrics: {
      likes: row.likes,
      replies: row.replies,
      reposts: row.reposts,
      views: row.views,
      engagementScore: round(row.engagementScore, 2),
    },
    relevanceScore: round(row.relevanceScore, 2),
    trendScore: round(row.trendScore, 2),
    opportunityScore: round(row.opportunityScore, 2),
    isRead: row.isRead,
    isSaved: row.isSaved,
    isHidden: row.isHidden,
    topicId: row.topicId,
    topicName: row.topic?.name ?? null,
    commentCount: row._count.comments,
    hasTranslation: row._count.translations > 0,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toPostRelevanceBreakdown(row: PostRow): RelevanceScoreBreakdown | null {
  return jsonAs(row.relevanceBreakdown, isRelevanceBreakdown);
}

export const COMMENT_SELECT = {
  id: true,
  postId: true,
  sourceCommentId: true,
  author: true,
  content: true,
  language: true,
  likes: true,
  publishedAt: true,
  createdAt: true,
} as const satisfies Prisma.CommentSelect;

export type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postId: row.postId,
    sourceCommentId: row.sourceCommentId,
    author: row.author,
    content: row.content,
    language: row.language,
    likes: row.likes,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
  };
}

export const TOPIC_SELECT = {
  id: true,
  name: true,
  slug: true,
  summary: true,
  status: true,
  classification: true,
  classificationReasons: true,
  postCount: true,
  commentCount: true,
  englishPostCount: true,
  arabicPostCount: true,
  distinctSourceCount: true,
  trendScore: true,
  relevanceScore: true,
  velocity: true,
  arabicOpportunityScore: true,
  trendBreakdown: true,
  arabicOpportunityBreakdown: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TopicSelect;

export type TopicRow = Prisma.TopicGetPayload<{ select: typeof TOPIC_SELECT }>;

export function toTopic(
  row: TopicRow,
  extras: { sourceKinds?: readonly Topic['sourceKinds'][number][]; isSaved?: boolean } = {},
): Topic {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    status: row.status,
    classification: row.classification,
    classificationReasons: jsonAs(row.classificationReasons, isSignalExplanations) ?? [],
    postCount: row.postCount,
    commentCount: row.commentCount,
    sourceKinds: extras.sourceKinds ?? [],
    trendScore: round(row.trendScore, 2),
    relevanceScore: round(row.relevanceScore, 2),
    velocity: round(row.velocity, 2),
    arabicOpportunityScore: round(row.arabicOpportunityScore, 2),
    englishPostCount: row.englishPostCount,
    arabicPostCount: row.arabicPostCount,
    firstDetectedAt: iso(row.firstDetectedAt),
    lastDetectedAt: iso(row.lastDetectedAt),
    isSaved: extras.isSaved ?? false,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toTopicTrendBreakdown(row: TopicRow): TrendScoreBreakdown | null {
  return jsonAs(row.trendBreakdown, isTrendBreakdown);
}

export function toTopicArabicBreakdown(row: TopicRow): ArabicOpportunityBreakdown | null {
  return jsonAs(row.arabicOpportunityBreakdown, isArabicOpportunityBreakdown);
}

export const TREND_SNAPSHOT_SELECT = {
  id: true,
  topicId: true,
  trendScore: true,
  postCount: true,
  engagement: true,
  velocity: true,
  relevance: true,
  freshness: true,
  crossSourceSignal: true,
  sourceAuthority: true,
  novelty: true,
  arabicOpportunity: true,
  saturationPenalty: true,
  recordedAt: true,
} as const satisfies Prisma.TrendSnapshotSelect;

export type TrendSnapshotRow = Prisma.TrendSnapshotGetPayload<{
  select: typeof TREND_SNAPSHOT_SELECT;
}>;

export function toTrendSnapshot(row: TrendSnapshotRow): TrendSnapshot {
  return {
    id: row.id,
    topicId: row.topicId,
    trendScore: round(row.trendScore, 2),
    postCount: row.postCount,
    engagement: round(row.engagement, 2),
    velocity: round(row.velocity, 2),
    relevance: round(row.relevance, 2),
    freshness: round(row.freshness, 2),
    crossSourceSignal: round(row.crossSourceSignal, 2),
    sourceAuthority: round(row.sourceAuthority, 2),
    novelty: round(row.novelty, 2),
    arabicOpportunity: round(row.arabicOpportunity, 2),
    saturationPenalty: round(row.saturationPenalty, 2),
    recordedAt: iso(row.recordedAt),
  };
}

export const SOURCE_SELECT = {
  id: true,
  kind: true,
  name: true,
  slug: true,
  enabled: true,
  authorityWeight: true,
  scanIntervalMinutes: true,
  lastScannedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SourceSelect;

export type SourceRow = Prisma.SourceGetPayload<{ select: typeof SOURCE_SELECT }>;

export function toSource(row: SourceRow, postCount = 0): Source {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    enabled: row.enabled,
    authorityWeight: row.authorityWeight,
    scanIntervalMinutes: row.scanIntervalMinutes,
    lastScannedAt: isoOrNull(row.lastScannedAt),
    postCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const INTEREST_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  weight: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  keywords: {
    select: { id: true, interestId: true, keyword: true, weight: true, createdAt: true },
    orderBy: { weight: 'desc' },
  },
} as const satisfies Prisma.InterestSelect;

export type InterestRow = Prisma.InterestGetPayload<{ select: typeof INTEREST_SELECT }>;

export function toInterest(row: InterestRow): Interest {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    weight: row.weight,
    enabled: row.enabled,
    keywords: row.keywords.map((keyword) => ({
      id: keyword.id,
      interestId: keyword.interestId,
      keyword: keyword.keyword,
      weight: keyword.weight,
      createdAt: iso(keyword.createdAt),
    })),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const TRANSLATION_SELECT = {
  id: true,
  userId: true,
  targetKind: true,
  postId: true,
  commentId: true,
  threadId: true,
  topicId: true,
  sourceLanguage: true,
  targetLanguage: true,
  mode: true,
  terminologyPreference: true,
  sourceContent: true,
  translatedContent: true,
  preservedTerms: true,
  explanation: true,
  providerName: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TranslationSelect;

export type TranslationRow = Prisma.TranslationGetPayload<{ select: typeof TRANSLATION_SELECT }>;

export function toTranslation(row: TranslationRow): Translation {
  return {
    id: row.id,
    userId: row.userId,
    targetKind: row.targetKind,
    postId: row.postId,
    commentId: row.commentId,
    threadId: row.threadId,
    topicId: row.topicId,
    sourceLanguage: row.sourceLanguage,
    targetLanguage: row.targetLanguage,
    mode: row.mode,
    terminologyPreference: row.terminologyPreference,
    sourceContent: row.sourceContent,
    translatedContent: row.translatedContent,
    preservedTerms: row.preservedTerms,
    explanation: row.explanation,
    providerName: row.providerName,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const THREAD_SELECT = {
  id: true,
  userId: true,
  topicId: true,
  title: true,
  language: true,
  status: true,
  isSaved: true,
  createdAt: true,
  updatedAt: true,
  posts: {
    select: { id: true, threadId: true, position: true, content: true, characterCount: true },
    orderBy: { position: 'asc' },
  },
} as const satisfies Prisma.ThreadSelect;

export type ThreadRow = Prisma.ThreadGetPayload<{ select: typeof THREAD_SELECT }>;

export function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    title: row.title,
    language: row.language,
    status: row.status,
    posts: row.posts.map((post) => ({
      id: post.id,
      threadId: post.threadId,
      position: post.position,
      content: post.content,
      characterCount: post.characterCount,
    })),
    isSaved: row.isSaved,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const CONTENT_DRAFT_SELECT = {
  id: true,
  userId: true,
  topicId: true,
  postId: true,
  threadId: true,
  kind: true,
  status: true,
  language: true,
  title: true,
  content: true,
  characterCount: true,
  tone: true,
  providerName: true,
  isSaved: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ContentDraftSelect;

export type ContentDraftRow = Prisma.ContentDraftGetPayload<{ select: typeof CONTENT_DRAFT_SELECT }>;

export function toContentDraft(row: ContentDraftRow): ContentDraft {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    postId: row.postId,
    threadId: row.threadId,
    kind: row.kind,
    status: row.status,
    language: row.language,
    title: row.title,
    content: row.content,
    characterCount: row.characterCount,
    tone: row.tone,
    providerName: row.providerName,
    isSaved: row.isSaved,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const SAVED_ITEM_SELECT = {
  id: true,
  userId: true,
  kind: true,
  postId: true,
  topicId: true,
  threadId: true,
  contentDraftId: true,
  note: true,
  collection: true,
  createdAt: true,
} as const satisfies Prisma.SavedItemSelect;

export type SavedItemRow = Prisma.SavedItemGetPayload<{ select: typeof SAVED_ITEM_SELECT }>;

export function toSavedItem(row: SavedItemRow): SavedItem {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    postId: row.postId,
    topicId: row.topicId,
    threadId: row.threadId,
    contentDraftId: row.contentDraftId,
    note: row.note,
    collection: row.collection,
    createdAt: iso(row.createdAt),
  };
}

export const MANUAL_PUBLICATION_SELECT = {
  id: true,
  userId: true,
  contentDraftId: true,
  threadId: true,
  topicId: true,
  contentKind: true,
  language: true,
  originalContent: true,
  publishedContent: true,
  publishedUrl: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ManualPublicationSelect;

export type ManualPublicationRow = Prisma.ManualPublicationGetPayload<{
  select: typeof MANUAL_PUBLICATION_SELECT;
}>;

export function toManualPublication(row: ManualPublicationRow): ManualPublication {
  return {
    id: row.id,
    userId: row.userId,
    contentDraftId: row.contentDraftId,
    threadId: row.threadId,
    topicId: row.topicId,
    contentKind: row.contentKind,
    language: row.language,
    originalContent: row.originalContent,
    publishedContent: row.publishedContent,
    publishedUrl: row.publishedUrl,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const SCAN_RUN_SELECT = {
  id: true,
  userId: true,
  trigger: true,
  status: true,
  sourceKinds: true,
  itemsCollected: true,
  itemsStored: true,
  duplicatesSkipped: true,
  postsCreated: true,
  commentsCreated: true,
  topicsCreated: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  failureReason: true,
} as const satisfies Prisma.ScanRunSelect;

export type ScanRunRow = Prisma.ScanRunGetPayload<{ select: typeof SCAN_RUN_SELECT }>;

export function toScanRun(row: ScanRunRow): ScanRun {
  return {
    id: row.id,
    userId: row.userId,
    trigger: row.trigger,
    status: row.status,
    sourceKinds: row.sourceKinds,
    itemsCollected: row.itemsCollected,
    itemsStored: row.itemsStored,
    duplicatesSkipped: row.duplicatesSkipped,
    postsCreated: row.postsCreated,
    commentsCreated: row.commentsCreated,
    topicsCreated: row.topicsCreated,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    durationMs: row.durationMs,
    failureReason: row.failureReason,
  };
}

export const JOB_RUN_SELECT = {
  id: true,
  queue: true,
  jobName: true,
  jobId: true,
  scanRunId: true,
  status: true,
  attempt: true,
  maxAttempts: true,
  durationMs: true,
  failureReason: true,
  startedAt: true,
  finishedAt: true,
} as const satisfies Prisma.JobRunSelect;

export type JobRunRow = Prisma.JobRunGetPayload<{ select: typeof JOB_RUN_SELECT }>;

export function toJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    queue: row.queue,
    jobName: row.jobName,
    jobId: row.jobId,
    scanRunId: row.scanRunId,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    durationMs: row.durationMs,
    failureReason: row.failureReason,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  };
}

export const API_USAGE_SELECT = {
  id: true,
  provider: true,
  operation: true,
  requestCount: true,
  successCount: true,
  failureCount: true,
  estimatedCost: true,
  recordedAt: true,
} as const satisfies Prisma.ApiUsageSelect;

export type ApiUsageRow = Prisma.ApiUsageGetPayload<{ select: typeof API_USAGE_SELECT }>;

export function toApiUsage(row: ApiUsageRow): ApiUsage {
  return {
    id: row.id,
    provider: row.provider,
    operation: row.operation,
    requestCount: row.requestCount,
    successCount: row.successCount,
    failureCount: row.failureCount,
    estimatedCost: round(row.estimatedCost, 4),
    recordedAt: iso(row.recordedAt),
  };
}

export const REPORT_SELECT = {
  id: true,
  userId: true,
  kind: true,
  title: true,
  rangeFrom: true,
  rangeTo: true,
  filters: true,
  payload: true,
  generatedAt: true,
} as const satisfies Prisma.ReportSelect;

export type ReportRow = Prisma.ReportGetPayload<{ select: typeof REPORT_SELECT }>;

export function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    title: row.title,
    rangeFrom: iso(row.rangeFrom),
    rangeTo: iso(row.rangeTo),
    filters:
      typeof row.filters === 'object' && row.filters !== null && !Array.isArray(row.filters)
        ? (row.filters)
        : {},
    payload: row.payload,
    generatedAt: iso(row.generatedAt),
  };
}

export const USER_SETTINGS_SELECT = {
  userId: true,
  locale: true,
  theme: true,
  translationMode: true,
  terminologyPreference: true,
  aiClassificationEnabled: true,
  emailNotificationsEnabled: true,
  emergingTrendAlerts: true,
  arabicOpportunityAlerts: true,
  defaultAnalyticsRange: true,
  updatedAt: true,
} as const satisfies Prisma.UserSettingsSelect;

export type UserSettingsRow = Prisma.UserSettingsGetPayload<{ select: typeof USER_SETTINGS_SELECT }>;

export function toUserSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.userId,
    locale: row.locale,
    theme: row.theme,
    translationMode: row.translationMode,
    terminologyPreference: row.terminologyPreference,
    aiClassificationEnabled: row.aiClassificationEnabled,
    emailNotificationsEnabled: row.emailNotificationsEnabled,
    emergingTrendAlerts: row.emergingTrendAlerts,
    arabicOpportunityAlerts: row.arabicOpportunityAlerts,
    defaultAnalyticsRange: row.defaultAnalyticsRange,
    updatedAt: iso(row.updatedAt),
  };
}

/** Turns grouped counts into the donut-chart slices the dashboard renders. */
export function toSourceDistribution(
  counts: readonly { source: SourceDistributionSlice['source']; count: number }[],
): SourceDistributionSlice[] {
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return [];
  return counts
    .map((entry) => ({
      source: entry.source,
      count: entry.count,
      percentage: round((entry.count / total) * 100, 1),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Recomputes engagement from raw counters, for backfills and repairs. */
export function recomputeEngagementScore(row: {
  likes: number;
  replies: number;
  reposts: number;
  views: number;
}): number {
  return calculateEngagementScore(row);
}
