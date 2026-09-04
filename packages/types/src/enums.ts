/**
 * Domain enumerations shared across every TrendHunter service.
 *
 * These are declared as `const` objects plus derived union types (rather than
 * TypeScript `enum`) so the values survive type-stripping runtimes, stay
 * structurally comparable with the Prisma-generated enums, and can be iterated
 * at runtime for validation and UI rendering.
 */

export const SOURCE_KINDS = ['X', 'REDDIT', 'HACKERNEWS', 'RSS', 'GITHUB'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CONTENT_LANGUAGES = ['EN', 'AR', 'OTHER'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

export const UI_LOCALES = ['en', 'ar'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const THEME_PREFERENCES = ['LIGHT', 'DARK', 'SYSTEM'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TOPIC_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

/**
 * How the trend engine classified a topic on its most recent evaluation.
 * Every classification carries machine-readable reasons (see `TopicSignalReason`).
 */
export const TOPIC_CLASSIFICATIONS = [
  'NORMAL',
  'EMERGING_TREND',
  'HIDDEN_GEM',
  'SATURATED',
] as const;
export type TopicClassification = (typeof TOPIC_CLASSIFICATIONS)[number];

export const TRANSLATION_MODES = [
  'LITERAL',
  'NATURAL',
  'X_STYLE',
  'PROFESSIONAL',
  'SIMPLE_ARABIC',
] as const;
export type TranslationMode = (typeof TRANSLATION_MODES)[number];

export const DEFAULT_TRANSLATION_MODE: TranslationMode = 'X_STYLE';

export const TERMINOLOGY_PREFERENCES = [
  'KEEP_COMMON_ENGLISH_TERMS',
  'ARABIC_WHEN_POSSIBLE',
  'FULL_ARABIC',
] as const;
export type TerminologyPreference = (typeof TERMINOLOGY_PREFERENCES)[number];

export const DEFAULT_TERMINOLOGY_PREFERENCE: TerminologyPreference = 'KEEP_COMMON_ENGLISH_TERMS';

export const TRANSLATION_TARGETS = ['POST', 'COMMENT', 'THREAD', 'TOPIC', 'FREEFORM'] as const;
export type TranslationTargetKind = (typeof TRANSLATION_TARGETS)[number];

export const CONTENT_DRAFT_KINDS = [
  'SHORT_X_POST',
  'LONG_X_POST',
  'X_THREAD',
  'EDUCATIONAL_POST',
  'OPINION_POST',
  'BUSINESS_ANGLE',
  'DEVELOPER_ANGLE',
  'SAUDI_MARKET_ANGLE',
  'SUMMARY',
  'HOOK',
  'CONTENT_IDEA',
] as const;
export type ContentDraftKind = (typeof CONTENT_DRAFT_KINDS)[number];

export const CONTENT_DRAFT_STATUSES = ['DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentDraftStatus = (typeof CONTENT_DRAFT_STATUSES)[number];

export const CONTENT_TONES = [
  'NEUTRAL',
  'FRIENDLY',
  'AUTHORITATIVE',
  'ANALYTICAL',
  'ENTHUSIASTIC',
  'CONTRARIAN',
] as const;
export type ContentTone = (typeof CONTENT_TONES)[number];

export const SAVED_ITEM_KINDS = ['POST', 'TOPIC', 'THREAD', 'CONTENT_DRAFT'] as const;
export type SavedItemKind = (typeof SAVED_ITEM_KINDS)[number];

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SCAN_TRIGGERS = ['MANUAL', 'SCHEDULED', 'SYSTEM'] as const;
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];

export const REPORT_KINDS = [
  'POSTS_COLLECTED',
  'TOPICS_DETECTED',
  'SOURCE_DISTRIBUTION',
  'TREND_GROWTH',
  'TOP_CATEGORIES',
  'ARABIC_OPPORTUNITIES',
  'TRANSLATION_ACTIVITY',
  'CONTENT_GENERATION',
  'SCAN_HISTORY',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const SEARCH_MODES = ['keyword', 'semantic', 'hybrid'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SEARCH_ENTITY_KINDS = ['post', 'comment', 'topic', 'source'] as const;
export type SearchEntityKind = (typeof SEARCH_ENTITY_KINDS)[number];

export const DATA_MODES = ['mock', 'live'] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const AI_PROVIDERS = ['mock', 'openai', 'anthropic', 'openai-compatible'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** Time ranges offered by the analytics widgets and report filters. */
export const ANALYTICS_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
