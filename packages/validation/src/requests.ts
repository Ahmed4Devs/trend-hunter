import {
  DEFAULT_COLLECT_LIMIT,
  MAX_COLLECT_LIMIT,
  MAX_THREAD_LENGTH,
  MIN_THREAD_LENGTH,
  X_LONG_POST_CHARACTER_LIMIT,
} from '@trendhunter/shared';
import {
  CONTENT_LANGUAGES,
  SEARCH_ENTITY_KINDS,
  SOURCE_KINDS,
  TOPIC_CLASSIFICATIONS,
} from '@trendhunter/types';
import { z } from 'zod';

import {
  analyticsRangeSchema,
  boundedTextSchema,
  contentDraftKindSchema,
  contentDraftStatusSchema,
  contentLanguageSchema,
  contentToneSchema,
  csvEnumQuerySchema,
  dateRangeSchema,
  idListSchema,
  idSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
  publicHttpsUrlSchema,
  reportKindSchema,
  savedItemKindSchema,
  scoreSchema,
  searchModeSchema,
  searchQuerySchema,
  sortDirectionSchema,
  sourceKindSchema,
  terminologyPreferenceSchema,
  themePreferenceSchema,
  topicStatusSchema,
  translationModeSchema,
  uiLocaleSchema,
  weightSchema,
} from './primitives';

/**
 * Request schemas for every `/api/v1` endpoint.
 *
 * These are the single source of truth for what the API accepts: Fastify
 * validates against them, the OpenAPI document is generated from them, and the
 * web client infers its request types from them. A field that is not here
 * cannot reach a service.
 */

// ---------------------------------------------------------------------------
// Common route parameters
// ---------------------------------------------------------------------------

export const idParamSchema = z.object({ id: idSchema });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  range: analyticsRangeSchema.default('7d'),
});

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export const POST_SORT_FIELDS = [
  'publishedAt',
  'collectedAt',
  'relevanceScore',
  'trendScore',
  'opportunityScore',
  'engagementScore',
] as const;

export const listPostsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema.optional(),
  sources: csvEnumQuerySchema(SOURCE_KINDS).optional(),
  languages: csvEnumQuerySchema(CONTENT_LANGUAGES).optional(),
  topicId: idSchema.optional(),
  publishedFrom: isoDateTimeSchema.optional(),
  publishedTo: isoDateTimeSchema.optional(),
  minRelevance: scoreSchema.optional(),
  minTrend: scoreSchema.optional(),
  minOpportunity: scoreSchema.optional(),
  isSaved: z.stringbool().optional(),
  isRead: z.stringbool().optional(),
  includeHidden: z.stringbool().default(false),
  sortBy: z.enum(POST_SORT_FIELDS).default('publishedAt'),
  sortDirection: sortDirectionSchema,
});

export const updatePostBodySchema = z
  .object({
    isRead: z.boolean().optional(),
    isHidden: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

export const listCommentsQuerySchema = paginationQuerySchema.extend({
  postId: idSchema.optional(),
  languages: csvEnumQuerySchema(CONTENT_LANGUAGES).optional(),
});

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export const TOPIC_SORT_FIELDS = [
  'trendScore',
  'relevanceScore',
  'arabicOpportunityScore',
  'postCount',
  'velocity',
  'firstDetectedAt',
  'lastDetectedAt',
] as const;

export const listTopicsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema.optional(),
  status: topicStatusSchema.default('ACTIVE'),
  classifications: csvEnumQuerySchema(TOPIC_CLASSIFICATIONS).optional(),
  sources: csvEnumQuerySchema(SOURCE_KINDS).optional(),
  minTrend: scoreSchema.optional(),
  minOpportunity: scoreSchema.optional(),
  savedOnly: z.stringbool().default(false),
  sortBy: z.enum(TOPIC_SORT_FIELDS).default('trendScore'),
  sortDirection: sortDirectionSchema,
});

export const topicTrendQuerySchema = z.object({
  range: analyticsRangeSchema.default('7d'),
});

export const updateTopicBodySchema = z
  .object({
    status: topicStatusSchema.optional(),
    summary: boundedTextSchema(2_000, { allowEmpty: true }).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export const trendsQuerySchema = z.object({
  range: analyticsRangeSchema.default('7d'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const updateSourceBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    authorityWeight: weightSchema.optional(),
    scanIntervalMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

/**
 * Source configuration is provider-specific, so it is validated per source
 * rather than as a free-form object: an unbounded JSON blob here would end up
 * in a connector without any guarantees.
 */
export const sourceConfigBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('X'),
    queries: z.array(boundedTextSchema(120)).min(1).max(20),
    includeReplies: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('REDDIT'),
    subreddits: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[A-Za-z0-9_]+$/u, 'is not a valid subreddit name'),
      )
      .min(1)
      .max(30),
    includeComments: z.boolean().default(true),
    commentLimit: z.coerce.number().int().min(0).max(100).default(20),
  }),
  z.object({
    kind: z.literal('HACKERNEWS'),
    stories: z.array(z.enum(['top', 'new', 'best', 'show', 'ask'])).min(1).default(['top']),
    minScore: z.coerce.number().int().min(0).max(10_000).default(0),
  }),
  z.object({
    kind: z.literal('RSS'),
    // Validated again by the SSRF guard immediately before each fetch: a feed
    // URL that resolves to a private address must never be requested.
    feedUrls: z.array(z.url().max(2048)).min(1).max(50),
  }),
  z.object({
    kind: z.literal('GITHUB'),
    repositories: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[\w.-]+\/[\w.-]+$/u, 'must be in owner/repo form')
          .max(140),
      )
      .max(50)
      .default([]),
    topics: z.array(boundedTextSchema(40)).max(20).default([]),
    includeReleases: z.boolean().default(true),
  }),
]);

// ---------------------------------------------------------------------------
// Interests
// ---------------------------------------------------------------------------

export const interestKeywordInputSchema = z.object({
  keyword: boundedTextSchema(60),
  weight: weightSchema.default(1),
});

export const createInterestBodySchema = z.object({
  name: boundedTextSchema(80),
  description: boundedTextSchema(500, { allowEmpty: true }).optional(),
  weight: weightSchema.default(1),
  enabled: z.boolean().default(true),
  keywords: z.array(interestKeywordInputSchema).max(100).default([]),
});

export const updateInterestBodySchema = createInterestBodySchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  'must change at least one field',
);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchRequestSchema = paginationQuerySchema.extend({
  q: searchQuerySchema,
  mode: searchModeSchema.default('hybrid'),
  entities: csvEnumQuerySchema(SEARCH_ENTITY_KINDS).optional(),
  sources: csvEnumQuerySchema(SOURCE_KINDS).optional(),
  languages: csvEnumQuerySchema(CONTENT_LANGUAGES).optional(),
  topicId: idSchema.optional(),
  publishedFrom: isoDateTimeSchema.optional(),
  publishedTo: isoDateTimeSchema.optional(),
  minRelevance: scoreSchema.optional(),
});

export const searchSuggestionsQuerySchema = z.object({
  q: searchQuerySchema,
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

export const createTranslationBodySchema = z
  .object({
    targetKind: z.enum(['POST', 'COMMENT', 'THREAD', 'TOPIC', 'FREEFORM']),
    targetId: idSchema.optional(),
    text: boundedTextSchema(20_000).optional(),
    sourceLanguage: contentLanguageSchema.optional(),
    targetLanguage: contentLanguageSchema.default('AR'),
    mode: translationModeSchema.optional(),
    terminologyPreference: terminologyPreferenceSchema.optional(),
    explain: z.boolean().default(false),
  })
  .refine(
    (body) => (body.targetKind === 'FREEFORM' ? body.text !== undefined : body.targetId !== undefined),
    { message: 'targetId is required unless targetKind is FREEFORM, which requires text' },
  );

export const listTranslationsQuerySchema = paginationQuerySchema.extend({
  targetKind: z.enum(['POST', 'COMMENT', 'THREAD', 'TOPIC', 'FREEFORM']).optional(),
  mode: translationModeSchema.optional(),
  search: searchQuerySchema.optional(),
});

export const updateTranslationBodySchema = z.object({
  translatedContent: boundedTextSchema(20_000),
});

// ---------------------------------------------------------------------------
// Content Studio
// ---------------------------------------------------------------------------

export const generateContentBodySchema = z
  .object({
    kind: contentDraftKindSchema,
    topicId: idSchema.optional(),
    postId: idSchema.optional(),
    language: contentLanguageSchema.default('EN'),
    tone: contentToneSchema.default('NEUTRAL'),
    maxCharacters: z.coerce.number().int().min(50).max(X_LONG_POST_CHARACTER_LIMIT).optional(),
    threadLength: z.coerce
      .number()
      .int()
      .min(MIN_THREAD_LENGTH)
      .max(MAX_THREAD_LENGTH)
      .optional(),
    instructions: boundedTextSchema(500, { allowEmpty: true }).optional(),
  })
  .refine((body) => body.topicId !== undefined || body.postId !== undefined, {
    message: 'either topicId or postId is required',
  });

export const rewriteContentBodySchema = z.object({
  operation: z.enum(['shorten', 'expand', 'rewrite', 'changeTone']),
  tone: contentToneSchema.optional(),
  targetCharacters: z.coerce.number().int().min(50).max(X_LONG_POST_CHARACTER_LIMIT).optional(),
});

export const updateContentDraftBodySchema = z
  .object({
    title: boundedTextSchema(200, { allowEmpty: true }).optional(),
    content: boundedTextSchema(X_LONG_POST_CHARACTER_LIMIT).optional(),
    status: contentDraftStatusSchema.optional(),
    isSaved: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

export const listContentDraftsQuerySchema = paginationQuerySchema.extend({
  kind: contentDraftKindSchema.optional(),
  status: contentDraftStatusSchema.optional(),
  topicId: idSchema.optional(),
  savedOnly: z.stringbool().default(false),
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const createThreadBodySchema = z
  .object({
    topicId: idSchema.optional(),
    postId: idSchema.optional(),
    title: boundedTextSchema(200).optional(),
    language: contentLanguageSchema.default('EN'),
    length: z.coerce.number().int().min(MIN_THREAD_LENGTH).max(MAX_THREAD_LENGTH).optional(),
    tone: contentToneSchema.default('NEUTRAL'),
  })
  .refine((body) => body.topicId !== undefined || body.postId !== undefined, {
    message: 'either topicId or postId is required',
  });

export const updateThreadBodySchema = z
  .object({
    title: boundedTextSchema(200).optional(),
    status: contentDraftStatusSchema.optional(),
    isSaved: z.boolean().optional(),
    posts: z
      .array(
        z.object({
          position: z.coerce.number().int().min(1).max(MAX_THREAD_LENGTH),
          content: boundedTextSchema(X_LONG_POST_CHARACTER_LIMIT),
        }),
      )
      .min(MIN_THREAD_LENGTH)
      .max(MAX_THREAD_LENGTH)
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

export const translateThreadBodySchema = z.object({
  targetLanguage: contentLanguageSchema.default('AR'),
  mode: translationModeSchema.optional(),
  terminologyPreference: terminologyPreferenceSchema.optional(),
});

export const listThreadsQuerySchema = paginationQuerySchema.extend({
  status: contentDraftStatusSchema.optional(),
  topicId: idSchema.optional(),
  savedOnly: z.stringbool().default(false),
});

// ---------------------------------------------------------------------------
// Saved items
// ---------------------------------------------------------------------------

export const createSavedItemBodySchema = z
  .object({
    kind: savedItemKindSchema,
    postId: idSchema.optional(),
    topicId: idSchema.optional(),
    threadId: idSchema.optional(),
    contentDraftId: idSchema.optional(),
    note: boundedTextSchema(500, { allowEmpty: true }).optional(),
    collection: boundedTextSchema(60, { allowEmpty: true }).optional(),
  })
  .refine(
    (body) =>
      [body.postId, body.topicId, body.threadId, body.contentDraftId].filter(
        (value) => value !== undefined,
      ).length === 1,
    { message: 'exactly one target identifier is required' },
  );

export const listSavedItemsQuerySchema = paginationQuerySchema.extend({
  kind: savedItemKindSchema.optional(),
  collection: boundedTextSchema(60).optional(),
});

// ---------------------------------------------------------------------------
// Manual publications
// ---------------------------------------------------------------------------

export const createManualPublicationBodySchema = z
  .object({
    contentDraftId: idSchema.optional(),
    threadId: idSchema.optional(),
    topicId: idSchema.optional(),
    contentKind: contentDraftKindSchema,
    language: contentLanguageSchema,
    publishedContent: boundedTextSchema(X_LONG_POST_CHARACTER_LIMIT * MAX_THREAD_LENGTH),
    publishedUrl: publicHttpsUrlSchema.optional(),
    publishedAt: isoDateTimeSchema.optional(),
  })
  .refine((body) => body.contentDraftId !== undefined || body.threadId !== undefined, {
    message: 'either contentDraftId or threadId is required',
  });

export const listManualPublicationsQuerySchema = paginationQuerySchema.extend({
  topicId: idSchema.optional(),
  contentKind: contentDraftKindSchema.optional(),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const generateReportBodySchema = z.object({
  kind: reportKindSchema,
  range: dateRangeSchema,
  sources: z.array(sourceKindSchema).max(SOURCE_KINDS.length).optional(),
  topicIds: idListSchema.max(50).optional(),
  languages: z.array(contentLanguageSchema).max(CONTENT_LANGUAGES.length).optional(),
});

export const listReportsQuerySchema = paginationQuerySchema.extend({
  kind: reportKindSchema.optional(),
});

// ---------------------------------------------------------------------------
// Scans and jobs
// ---------------------------------------------------------------------------

/**
 * "Scan Now" only ever enqueues work. The collectors must not run inside the
 * HTTP request: they are slow, rate-limited and retryable, which is exactly
 * what the queue is for.
 */
export const createScanBodySchema = z.object({
  sources: z.array(sourceKindSchema).min(1).max(SOURCE_KINDS.length).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_COLLECT_LIMIT)
    .default(DEFAULT_COLLECT_LIMIT),
});

export const listScansQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
});

export const listJobsQuerySchema = paginationQuerySchema.extend({
  queue: boundedTextSchema(60).optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  scanRunId: idSchema.optional(),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const updateUserSettingsBodySchema = z
  .object({
    locale: uiLocaleSchema.optional(),
    theme: themePreferenceSchema.optional(),
    translationMode: translationModeSchema.optional(),
    terminologyPreference: terminologyPreferenceSchema.optional(),
    aiClassificationEnabled: z.boolean().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    emergingTrendAlerts: z.boolean().optional(),
    arabicOpportunityAlerts: z.boolean().optional(),
    defaultAnalyticsRange: analyticsRangeSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

export const updateProfileBodySchema = z
  .object({
    name: boundedTextSchema(80).optional(),
    image: publicHttpsUrlSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

// ---------------------------------------------------------------------------
// Inferred request types
// ---------------------------------------------------------------------------

export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type CreateTranslationBody = z.infer<typeof createTranslationBodySchema>;
export type GenerateContentBody = z.infer<typeof generateContentBodySchema>;
export type CreateThreadBody = z.infer<typeof createThreadBodySchema>;
export type CreateScanBody = z.infer<typeof createScanBodySchema>;
export type GenerateReportBody = z.infer<typeof generateReportBodySchema>;
export type SourceConfigBody = z.infer<typeof sourceConfigBodySchema>;
export type CreateInterestBody = z.infer<typeof createInterestBodySchema>;
export type UpdateUserSettingsBody = z.infer<typeof updateUserSettingsBodySchema>;
export type CreateManualPublicationBody = z.infer<typeof createManualPublicationBodySchema>;
export type CreateSavedItemBody = z.infer<typeof createSavedItemBodySchema>;
