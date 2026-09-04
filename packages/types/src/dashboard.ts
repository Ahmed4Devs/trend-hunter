import type { AnalyticsRange, ReportKind, SourceKind } from './enums';
import type {
  IsoDateTime,
  Post,
  SourceDistributionSlice,
  Topic,
  TrendSnapshot,
} from './domain';

/**
 * Read models for the dashboard, analytics and reporting surfaces.
 *
 * Every value in here is computed from PostgreSQL. Nothing on these shapes may
 * be synthesised in the browser: the acceptance criteria require the dashboard
 * to reflect real database state even while the collectors run in mock mode.
 */

export const KPI_KEYS = [
  'newTopics',
  'newPosts',
  'relevantIdeas',
  'savedItems',
  'emergingTrends',
  'arabicOpportunities',
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export interface KpiCard {
  readonly key: KpiKey;
  readonly value: number;
  /** Value over the immediately preceding window of the same length. */
  readonly previousValue: number;
  /**
   * Percentage change versus `previousValue`, rounded to one decimal.
   * `null` when the previous window was empty (an increase from zero is not a
   * meaningful percentage and must not be rendered as one).
   */
  readonly changePercentage: number | null;
}

export interface TrendingTopicSummary {
  readonly rank: number;
  readonly topicId: string;
  readonly name: string;
  readonly postCount: number;
  /** Percentage growth over the sparkline window; `null` when unknown. */
  readonly growthPercentage: number | null;
  readonly trendScore: number;
  /** Chronological trend scores used to draw the sparkline. */
  readonly sparkline: readonly number[];
}

export interface ActivityBucket {
  readonly bucketStart: IsoDateTime;
  readonly postsCollected: number;
  readonly relevantIdeas: number;
  readonly topicsCreated: number;
  readonly translations: number;
}

export interface ApiUsageSummary {
  readonly provider: string;
  readonly operation: string;
  readonly requestCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly estimatedCost: number;
  /** Configured monthly request quota, or `null` when the provider has none. */
  readonly quotaLimit: number | null;
  /** 0..100 usage of `quotaLimit`; `null` when there is no quota. */
  readonly quotaUsedPercentage: number | null;
}

export interface SystemHealthSummary {
  readonly database: 'up' | 'down';
  readonly redis: 'up' | 'down';
  readonly worker: 'up' | 'stale' | 'down';
  readonly workerLastHeartbeatAt: IsoDateTime | null;
  readonly queueDepth: number;
  readonly failedJobs24h: number;
}

export interface DashboardSummary {
  readonly range: AnalyticsRange;
  readonly generatedAt: IsoDateTime;
  readonly kpis: readonly KpiCard[];
  readonly trendingTopics: readonly TrendingTopicSummary[];
  readonly sourceDistribution: readonly SourceDistributionSlice[];
  readonly totalPosts: number;
  readonly recentPosts: readonly Post[];
  readonly activity: readonly ActivityBucket[];
  readonly apiUsage: readonly ApiUsageSummary[];
  readonly health: SystemHealthSummary;
}

export interface EmergingTopicsView {
  readonly emerging: readonly Topic[];
  readonly hiddenGems: readonly Topic[];
}

export interface TopicTrendSeries {
  readonly topicId: string;
  readonly topicName: string;
  readonly snapshots: readonly TrendSnapshot[];
}

export interface ReportRequestFilters {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly sources?: readonly SourceKind[];
  readonly topicIds?: readonly string[];
  readonly languages?: readonly string[];
}

export interface ReportSeriesPoint {
  readonly label: string;
  readonly value: number;
  readonly secondaryValue?: number;
}

export interface ReportResult {
  readonly kind: ReportKind;
  readonly title: string;
  readonly filters: ReportRequestFilters;
  readonly generatedAt: IsoDateTime;
  readonly total: number;
  readonly series: readonly ReportSeriesPoint[];
  readonly breakdown: readonly ReportSeriesPoint[];
}
