import {
  CONTENT_DRAFT_KINDS,
  CONTENT_DRAFT_STATUSES,
  CONTENT_LANGUAGES,
  REPORT_KINDS,
  SAVED_ITEM_KINDS,
  SOURCE_KINDS,
  TERMINOLOGY_PREFERENCES,
  THEME_PREFERENCES,
  TOPIC_CLASSIFICATIONS,
  TOPIC_STATUSES,
  TRANSLATION_MODES,
  TRANSLATION_TARGETS,
  UI_LOCALES,
} from '@trendhunter/types';
import { z } from 'zod';

/**
 * Response schemas.
 *
 * These describe what the API *returns*, as opposed to `@trendhunter/validation`
 * which describes what it accepts. They are registered in `z.globalRegistry` so
 * the generated OpenAPI document references them by name instead of inlining
 * the same object into forty operations.
 *
 * Serialisation is not merely documentation here: `fastify-type-provider-zod`
 * encodes every response through these schemas, so a handler that returns a
 * field not declared below cannot leak it — the field is dropped.
 */

function registered<TSchema extends z.ZodType>(id: string, schema: TSchema): TSchema {
  z.globalRegistry.add(schema, { id });
  return schema;
}

/**
 * A readonly array.
 *
 * The domain types are readonly throughout, and the serializer infers the
 * response type from these schemas, so declaring the arrays readonly is what
 * lets a handler return a domain object directly instead of copying it into a
 * mutable shape at every call site.
 */
function roArray<TSchema extends z.ZodType>(item: TSchema) {
  return z.array(item).readonly();
}

const isoDateTime = z.iso.datetime();

export const postMetricsSchema = registered(
  'PostMetrics',
  z.object({
    likes: z.number().int(),
    replies: z.number().int(),
    reposts: z.number().int(),
    views: z.number().int(),
    engagementScore: z.number(),
  }),
);

export const postSchema = registered(
  'Post',
  z.object({
    id: z.string(),
    source: z.enum(SOURCE_KINDS),
    sourcePostId: z.string(),
    authorId: z.string().nullable(),
    authorName: z.string().nullable(),
    authorUsername: z.string().nullable(),
    title: z.string().nullable(),
    content: z.string(),
    url: z.string(),
    language: z.enum(CONTENT_LANGUAGES),
    publishedAt: isoDateTime,
    collectedAt: isoDateTime,
    metrics: postMetricsSchema,
    relevanceScore: z.number(),
    trendScore: z.number(),
    opportunityScore: z.number(),
    isRead: z.boolean(),
    isSaved: z.boolean(),
    isHidden: z.boolean(),
    topicId: z.string().nullable(),
    topicName: z.string().nullable(),
    commentCount: z.number().int(),
    hasTranslation: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const commentSchema = registered(
  'Comment',
  z.object({
    id: z.string(),
    postId: z.string(),
    sourceCommentId: z.string(),
    author: z.string().nullable(),
    content: z.string(),
    language: z.enum(CONTENT_LANGUAGES),
    likes: z.number().int(),
    publishedAt: isoDateTime,
    createdAt: isoDateTime,
  }),
);

const relevanceComponentsSchema = z.object({
  keyword: z.number(),
  semantic: z.number(),
  sourceQuality: z.number(),
  aiClassification: z.number().nullable(),
});

const trendComponentsSchema = z.object({
  relevance: z.number(),
  velocity: z.number(),
  freshness: z.number(),
  crossSourceSignal: z.number(),
  sourceAuthority: z.number(),
  novelty: z.number(),
  arabicOpportunity: z.number(),
});

const arabicOpportunityComponentsSchema = z.object({
  englishVolume: z.number(),
  arabicScarcity: z.number(),
  velocity: z.number(),
  relevance: z.number(),
  freshness: z.number(),
  sourceAuthority: z.number(),
});

export const relevanceBreakdownSchema = registered(
  'RelevanceBreakdown',
  z.object({
    components: relevanceComponentsSchema,
    matchedInterestIds: roArray(z.string()),
    matchedKeywords: roArray(z.string()),
    relevanceScore: z.number(),
  }),
);

export const trendBreakdownSchema = registered(
  'TrendBreakdown',
  z.object({
    components: trendComponentsSchema,
    saturationPenalty: z.number(),
    weightedScore: z.number(),
    trendScore: z.number(),
  }),
);

export const arabicOpportunityBreakdownSchema = registered(
  'ArabicOpportunityBreakdown',
  z.object({
    components: arabicOpportunityComponentsSchema,
    englishPostCount: z.number().int(),
    arabicPostCount: z.number().int(),
    arabicOpportunityScore: z.number(),
  }),
);

export const topicSignalSchema = registered(
  'TopicSignal',
  z.object({
    reason: z.string(),
    detail: z.record(z.string(), z.number()),
  }),
);

export const trendSnapshotSchema = registered(
  'TrendSnapshot',
  z.object({
    id: z.string(),
    topicId: z.string(),
    trendScore: z.number(),
    postCount: z.number().int(),
    engagement: z.number(),
    velocity: z.number(),
    relevance: z.number(),
    freshness: z.number(),
    crossSourceSignal: z.number(),
    sourceAuthority: z.number(),
    novelty: z.number(),
    arabicOpportunity: z.number(),
    saturationPenalty: z.number(),
    recordedAt: isoDateTime,
  }),
);

export const sourceDistributionSchema = registered(
  'SourceDistributionSlice',
  z.object({
    source: z.string(),
    count: z.number().int(),
    percentage: z.number(),
  }),
);

export const topicSchema = registered(
  'Topic',
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    summary: z.string().nullable(),
    status: z.enum(TOPIC_STATUSES),
    classification: z.enum(TOPIC_CLASSIFICATIONS),
    classificationReasons: roArray(topicSignalSchema),
    postCount: z.number().int(),
    commentCount: z.number().int(),
    sourceKinds: roArray(z.enum(SOURCE_KINDS)),
    trendScore: z.number(),
    relevanceScore: z.number(),
    velocity: z.number(),
    arabicOpportunityScore: z.number(),
    englishPostCount: z.number().int(),
    arabicPostCount: z.number().int(),
    firstDetectedAt: isoDateTime,
    lastDetectedAt: isoDateTime,
    isSaved: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const postDetailSchema = registered(
  'PostDetail',
  postSchema.extend({
    relevanceBreakdown: relevanceBreakdownSchema.nullable(),
    rawMetadata: z.record(z.string(), z.unknown()).nullable(),
    comments: roArray(commentSchema),
    relatedPosts: roArray(postSchema),
    translations: roArray(z.unknown()),
  }),
);

export const topicDetailSchema = registered(
  'TopicDetail',
  topicSchema.extend({
    trendBreakdown: trendBreakdownSchema.nullable(),
    arabicOpportunityBreakdown: arabicOpportunityBreakdownSchema.nullable(),
    snapshots: roArray(trendSnapshotSchema),
    posts: roArray(postSchema),
    sourceBreakdown: roArray(sourceDistributionSchema),
  }),
);

export const sourceSchema = registered(
  'Source',
  z.object({
    id: z.string(),
    kind: z.enum(SOURCE_KINDS),
    name: z.string(),
    slug: z.string(),
    enabled: z.boolean(),
    authorityWeight: z.number(),
    scanIntervalMinutes: z.number().int(),
    lastScannedAt: isoDateTime.nullable(),
    postCount: z.number().int(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const interestKeywordSchema = registered(
  'InterestKeyword',
  z.object({
    id: z.string(),
    interestId: z.string(),
    keyword: z.string(),
    weight: z.number(),
    createdAt: isoDateTime,
  }),
);

export const interestSchema = registered(
  'Interest',
  z.object({
    id: z.string(),
    userId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    weight: z.number(),
    enabled: z.boolean(),
    keywords: roArray(interestKeywordSchema),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const translationSchema = registered(
  'Translation',
  z.object({
    id: z.string(),
    userId: z.string(),
    targetKind: z.enum(TRANSLATION_TARGETS),
    postId: z.string().nullable(),
    commentId: z.string().nullable(),
    threadId: z.string().nullable(),
    topicId: z.string().nullable(),
    sourceLanguage: z.enum(CONTENT_LANGUAGES),
    targetLanguage: z.enum(CONTENT_LANGUAGES),
    mode: z.enum(TRANSLATION_MODES),
    terminologyPreference: z.enum(TERMINOLOGY_PREFERENCES),
    sourceContent: z.string(),
    translatedContent: z.string(),
    preservedTerms: roArray(z.string()),
    explanation: z.string().nullable(),
    providerName: z.string(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const threadPostSchema = registered(
  'ThreadPost',
  z.object({
    id: z.string(),
    threadId: z.string(),
    position: z.number().int(),
    content: z.string(),
    characterCount: z.number().int(),
  }),
);

export const threadSchema = registered(
  'Thread',
  z.object({
    id: z.string(),
    userId: z.string(),
    topicId: z.string().nullable(),
    title: z.string(),
    language: z.enum(CONTENT_LANGUAGES),
    status: z.enum(CONTENT_DRAFT_STATUSES),
    posts: roArray(threadPostSchema),
    isSaved: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const contentDraftSchema = registered(
  'ContentDraft',
  z.object({
    id: z.string(),
    userId: z.string(),
    topicId: z.string().nullable(),
    postId: z.string().nullable(),
    threadId: z.string().nullable(),
    kind: z.enum(CONTENT_DRAFT_KINDS),
    status: z.enum(CONTENT_DRAFT_STATUSES),
    language: z.enum(CONTENT_LANGUAGES),
    title: z.string().nullable(),
    content: z.string(),
    characterCount: z.number().int(),
    tone: z.string().nullable(),
    providerName: z.string(),
    isSaved: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const savedItemSchema = registered(
  'SavedItem',
  z.object({
    id: z.string(),
    userId: z.string(),
    kind: z.enum(SAVED_ITEM_KINDS),
    postId: z.string().nullable(),
    topicId: z.string().nullable(),
    threadId: z.string().nullable(),
    contentDraftId: z.string().nullable(),
    note: z.string().nullable(),
    collection: z.string().nullable(),
    createdAt: isoDateTime,
  }),
);

export const manualPublicationSchema = registered(
  'ManualPublication',
  z.object({
    id: z.string(),
    userId: z.string(),
    contentDraftId: z.string().nullable(),
    threadId: z.string().nullable(),
    topicId: z.string().nullable(),
    contentKind: z.enum(CONTENT_DRAFT_KINDS),
    language: z.enum(CONTENT_LANGUAGES),
    originalContent: z.string(),
    publishedContent: z.string(),
    publishedUrl: z.string().nullable(),
    publishedAt: isoDateTime,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
);

export const scanRunSchema = registered(
  'ScanRun',
  z.object({
    id: z.string(),
    userId: z.string().nullable(),
    trigger: z.enum(['MANUAL', 'SCHEDULED', 'SYSTEM']),
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
    sourceKinds: roArray(z.enum(SOURCE_KINDS)),
    itemsCollected: z.number().int(),
    itemsStored: z.number().int(),
    duplicatesSkipped: z.number().int(),
    postsCreated: z.number().int(),
    commentsCreated: z.number().int(),
    topicsCreated: z.number().int(),
    startedAt: isoDateTime,
    finishedAt: isoDateTime.nullable(),
    durationMs: z.number().int().nullable(),
    failureReason: z.string().nullable(),
  }),
);

export const jobRunSchema = registered(
  'JobRun',
  z.object({
    id: z.string(),
    queue: z.string(),
    jobName: z.string(),
    jobId: z.string(),
    scanRunId: z.string().nullable(),
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
    attempt: z.number().int(),
    maxAttempts: z.number().int(),
    durationMs: z.number().int().nullable(),
    failureReason: z.string().nullable(),
    startedAt: isoDateTime,
    finishedAt: isoDateTime.nullable(),
  }),
);

export const userSettingsSchema = registered(
  'UserSettings',
  z.object({
    userId: z.string(),
    locale: z.enum(UI_LOCALES),
    theme: z.enum(THEME_PREFERENCES),
    translationMode: z.enum(TRANSLATION_MODES),
    terminologyPreference: z.enum(TERMINOLOGY_PREFERENCES),
    aiClassificationEnabled: z.boolean(),
    emailNotificationsEnabled: z.boolean(),
    emergingTrendAlerts: z.boolean(),
    arabicOpportunityAlerts: z.boolean(),
    defaultAnalyticsRange: z.string(),
    updatedAt: isoDateTime,
  }),
);

export const authenticatedUserSchema = registered(
  'AuthenticatedUser',
  z.object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    image: z.string().nullable(),
    role: z.enum(['USER', 'ADMIN']),
    emailVerified: z.boolean(),
    createdAt: isoDateTime,
  }),
);

export const reportSchema = registered(
  'Report',
  z.object({
    id: z.string(),
    userId: z.string(),
    kind: z.enum(REPORT_KINDS),
    title: z.string(),
    rangeFrom: isoDateTime,
    rangeTo: isoDateTime,
    filters: z.record(z.string(), z.unknown()),
    payload: z.unknown(),
    generatedAt: isoDateTime,
  }),
);

export const apiUsageSummarySchema = registered(
  'ApiUsageSummary',
  z.object({
    provider: z.string(),
    operation: z.string(),
    requestCount: z.number().int(),
    successCount: z.number().int(),
    failureCount: z.number().int(),
    estimatedCost: z.number(),
    quotaLimit: z.number().int().nullable(),
    quotaUsedPercentage: z.number().nullable(),
  }),
);
