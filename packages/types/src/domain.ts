import type {
  ContentDraftKind,
  ContentDraftStatus,
  ContentLanguage,
  JobStatus,
  ReportKind,
  SavedItemKind,
  ScanTrigger,
  SourceKind,
  TerminologyPreference,
  ThemePreference,
  TopicClassification,
  TopicStatus,
  TranslationMode,
  TranslationTargetKind,
  UiLocale,
  UserRole,
} from './enums';
import type {
  ArabicOpportunityBreakdown,
  RelevanceScoreBreakdown,
  TopicSignalExplanation,
  TrendScoreBreakdown,
} from './scoring';

/**
 * Transport-level domain shapes.
 *
 * These are the objects the API returns and the web app consumes. They are
 * deliberately not the Prisma model types: dates are ISO-8601 strings, secrets
 * and internal columns (embeddings, raw payload pointers) are never present, and
 * every field is readonly so consumers cannot mutate server state by accident.
 */

/** ISO-8601 timestamp in UTC, e.g. 2026-09-04T10:15:00.000Z */
export type IsoDateTime = string;

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly createdAt: IsoDateTime;
}

export interface UserSettings {
  readonly userId: string;
  readonly locale: UiLocale;
  readonly theme: ThemePreference;
  readonly translationMode: TranslationMode;
  readonly terminologyPreference: TerminologyPreference;
  readonly aiClassificationEnabled: boolean;
  readonly emailNotificationsEnabled: boolean;
  readonly emergingTrendAlerts: boolean;
  readonly arabicOpportunityAlerts: boolean;
  readonly defaultAnalyticsRange: string;
  readonly updatedAt: IsoDateTime;
}

export interface InterestKeyword {
  readonly id: string;
  readonly interestId: string;
  readonly keyword: string;
  /** 0..1 multiplier applied to this keyword's contribution. */
  readonly weight: number;
  readonly createdAt: IsoDateTime;
}

export interface Interest {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  /** 0..1 multiplier applied to every keyword under this interest. */
  readonly weight: number;
  readonly enabled: boolean;
  readonly keywords: readonly InterestKeyword[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface Source {
  readonly id: string;
  readonly kind: SourceKind;
  readonly name: string;
  readonly slug: string;
  readonly enabled: boolean;
  /** 0..1 static authority weight fed into relevance and trend scoring. */
  readonly authorityWeight: number;
  /** Minimum minutes between two scheduled collections. */
  readonly scanIntervalMinutes: number;
  readonly lastScannedAt: IsoDateTime | null;
  readonly postCount: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface SourceConfigEntry {
  readonly id: string;
  readonly sourceId: string;
  /** Provider-specific key, for example subreddits, feedUrls or queries. */
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: IsoDateTime;
}

export interface PostMetrics {
  readonly likes: number;
  readonly replies: number;
  readonly reposts: number;
  readonly views: number;
  /** Normalised 0..100 engagement signal derived from the raw counters. */
  readonly engagementScore: number;
}

export interface Post {
  readonly id: string;
  readonly source: SourceKind;
  readonly sourcePostId: string;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly authorUsername: string | null;
  readonly title: string | null;
  readonly content: string;
  readonly url: string;
  readonly language: ContentLanguage;
  readonly publishedAt: IsoDateTime;
  readonly collectedAt: IsoDateTime;
  readonly metrics: PostMetrics;
  readonly relevanceScore: number;
  readonly trendScore: number;
  readonly opportunityScore: number;
  readonly isRead: boolean;
  readonly isSaved: boolean;
  readonly isHidden: boolean;
  readonly topicId: string | null;
  readonly topicName: string | null;
  readonly commentCount: number;
  readonly hasTranslation: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** A post plus the expensive detail payloads only fetched on the detail page. */
export interface PostDetail extends Post {
  readonly relevanceBreakdown: RelevanceScoreBreakdown | null;
  readonly rawMetadata: Readonly<Record<string, unknown>> | null;
  readonly comments: readonly Comment[];
  readonly relatedPosts: readonly Post[];
  readonly translations: readonly Translation[];
}

export interface Comment {
  readonly id: string;
  readonly postId: string;
  readonly sourceCommentId: string;
  readonly author: string | null;
  readonly content: string;
  readonly language: ContentLanguage;
  readonly likes: number;
  readonly publishedAt: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

export interface Topic {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly summary: string | null;
  readonly status: TopicStatus;
  readonly classification: TopicClassification;
  readonly classificationReasons: readonly TopicSignalExplanation[];
  readonly postCount: number;
  readonly commentCount: number;
  readonly sourceKinds: readonly SourceKind[];
  readonly trendScore: number;
  readonly relevanceScore: number;
  readonly velocity: number;
  readonly arabicOpportunityScore: number;
  readonly englishPostCount: number;
  readonly arabicPostCount: number;
  readonly firstDetectedAt: IsoDateTime;
  readonly lastDetectedAt: IsoDateTime;
  readonly isSaved: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface TopicDetail extends Topic {
  readonly trendBreakdown: TrendScoreBreakdown | null;
  readonly arabicOpportunityBreakdown: ArabicOpportunityBreakdown | null;
  readonly snapshots: readonly TrendSnapshot[];
  readonly posts: readonly Post[];
  readonly sourceBreakdown: readonly SourceDistributionSlice[];
}

export interface TrendSnapshot {
  readonly id: string;
  readonly topicId: string;
  readonly trendScore: number;
  readonly postCount: number;
  readonly engagement: number;
  readonly velocity: number;
  readonly relevance: number;
  readonly freshness: number;
  readonly crossSourceSignal: number;
  readonly sourceAuthority: number;
  readonly novelty: number;
  readonly arabicOpportunity: number;
  readonly saturationPenalty: number;
  readonly recordedAt: IsoDateTime;
}

export interface SourceDistributionSlice {
  readonly source: SourceKind | 'OTHER';
  readonly count: number;
  /** 0..100, rounded to one decimal. */
  readonly percentage: number;
}

export interface SavedItem {
  readonly id: string;
  readonly userId: string;
  readonly kind: SavedItemKind;
  readonly postId: string | null;
  readonly topicId: string | null;
  readonly threadId: string | null;
  readonly contentDraftId: string | null;
  readonly note: string | null;
  readonly collection: string | null;
  readonly createdAt: IsoDateTime;
}

export interface Translation {
  readonly id: string;
  readonly userId: string;
  readonly targetKind: TranslationTargetKind;
  readonly postId: string | null;
  readonly commentId: string | null;
  readonly threadId: string | null;
  readonly topicId: string | null;
  readonly sourceLanguage: ContentLanguage;
  readonly targetLanguage: ContentLanguage;
  readonly mode: TranslationMode;
  readonly terminologyPreference: TerminologyPreference;
  readonly sourceContent: string;
  readonly translatedContent: string;
  /** Terms deliberately preserved in their original language. */
  readonly preservedTerms: readonly string[];
  readonly explanation: string | null;
  readonly providerName: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ThreadPost {
  readonly id: string;
  readonly threadId: string;
  /** 1-based position within the thread. */
  readonly position: number;
  readonly content: string;
  readonly characterCount: number;
}

export interface Thread {
  readonly id: string;
  readonly userId: string;
  readonly topicId: string | null;
  readonly title: string;
  readonly language: ContentLanguage;
  readonly status: ContentDraftStatus;
  readonly posts: readonly ThreadPost[];
  readonly isSaved: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ContentDraft {
  readonly id: string;
  readonly userId: string;
  readonly topicId: string | null;
  readonly postId: string | null;
  readonly threadId: string | null;
  readonly kind: ContentDraftKind;
  readonly status: ContentDraftStatus;
  readonly language: ContentLanguage;
  readonly title: string | null;
  readonly content: string;
  readonly characterCount: number;
  readonly tone: string | null;
  readonly providerName: string;
  readonly isSaved: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ManualPublication {
  readonly id: string;
  readonly userId: string;
  readonly contentDraftId: string | null;
  readonly threadId: string | null;
  readonly topicId: string | null;
  readonly contentKind: ContentDraftKind;
  readonly language: ContentLanguage;
  readonly originalContent: string;
  readonly publishedContent: string;
  readonly publishedUrl: string | null;
  readonly publishedAt: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ScanRun {
  readonly id: string;
  readonly userId: string | null;
  readonly trigger: ScanTrigger;
  readonly status: JobStatus;
  readonly sourceKinds: readonly SourceKind[];
  readonly itemsCollected: number;
  readonly itemsStored: number;
  readonly duplicatesSkipped: number;
  readonly postsCreated: number;
  readonly commentsCreated: number;
  readonly topicsCreated: number;
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
  readonly durationMs: number | null;
  readonly failureReason: string | null;
}

export interface JobRun {
  readonly id: string;
  readonly queue: string;
  readonly jobName: string;
  readonly jobId: string;
  readonly scanRunId: string | null;
  readonly status: JobStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly durationMs: number | null;
  readonly failureReason: string | null;
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
}

export interface ApiUsage {
  readonly id: string;
  readonly provider: string;
  readonly operation: string;
  readonly requestCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  /** Estimated cost in USD; always 0 while running in mock mode. */
  readonly estimatedCost: number;
  readonly recordedAt: IsoDateTime;
}

export interface Report {
  readonly id: string;
  readonly userId: string;
  readonly kind: ReportKind;
  readonly title: string;
  readonly rangeFrom: IsoDateTime;
  readonly rangeTo: IsoDateTime;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly payload: unknown;
  readonly generatedAt: IsoDateTime;
}

export interface SystemSetting {
  readonly id: string;
  readonly key: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly updatedAt: IsoDateTime;
}
