import {
  ANALYTICS_RANGE_BUCKET_HOURS,
  ANALYTICS_RANGE_HOURS,
  bucketStarts,
  percentageChange,
  previousWindow,
  windowForRange,
} from '@trendhunter/shared';
import type {
  ActivityBucket,
  AnalyticsRange,
  KpiCard,
  KpiKey,
  SourceDistributionSlice,
  TrendingTopicSummary,
} from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { withDatabaseErrors } from '../errors';
import { toSourceDistribution } from '../mappers';

/**
 * Dashboard and report aggregation.
 *
 * Every number the dashboard shows is computed here, in SQL, from real rows.
 * The acceptance criteria are explicit that the UI must not synthesise metrics,
 * and this is where that is enforced: there is no code path from a dashboard
 * card to anything but a query.
 *
 * The bucketed series are built with `generate_series` and a LEFT JOIN rather
 * than by grouping and filling gaps in JavaScript, so an hour with no activity
 * is a zero in the chart instead of a missing point that the line silently
 * jumps over.
 */

/** Relevance at or above which a post counts as a "relevant idea". */
const RELEVANT_IDEA_THRESHOLD = 60;

export function createAnalyticsRepository(client: PrismaClient) {
  return {
    /**
     * The KPI cards.
     *
     * Each is measured over the requested window and over the window
     * immediately before it, so the percentage change compares like with like.
     * A change from zero is reported as `null` rather than as a percentage,
     * because "up 100%" from nothing is meaningless and renders as noise.
     */
    async loadKpis(range: AnalyticsRange, userId: string, now: Date): Promise<KpiCard[]> {
      const current = windowForRange(range, now);
      const previous = previousWindow(current);

      return withDatabaseErrors('Dashboard', async () => {
        const rows = await client.$queryRaw<Record<KpiKey | `previous_${KpiKey}`, bigint>[]>`
          SELECT
            (SELECT COUNT(*) FROM "topics"
               WHERE "created_at" >= ${current.from} AND "created_at" < ${current.to})
              AS "newTopics",
            (SELECT COUNT(*) FROM "topics"
               WHERE "created_at" >= ${previous.from} AND "created_at" < ${previous.to})
              AS "previous_newTopics",

            (SELECT COUNT(*) FROM "posts"
               WHERE "collected_at" >= ${current.from} AND "collected_at" < ${current.to}
                 AND "is_hidden" = false)
              AS "newPosts",
            (SELECT COUNT(*) FROM "posts"
               WHERE "collected_at" >= ${previous.from} AND "collected_at" < ${previous.to}
                 AND "is_hidden" = false)
              AS "previous_newPosts",

            (SELECT COUNT(*) FROM "posts"
               WHERE "collected_at" >= ${current.from} AND "collected_at" < ${current.to}
                 AND "is_hidden" = false AND "relevance_score" >= ${RELEVANT_IDEA_THRESHOLD})
              AS "relevantIdeas",
            (SELECT COUNT(*) FROM "posts"
               WHERE "collected_at" >= ${previous.from} AND "collected_at" < ${previous.to}
                 AND "is_hidden" = false AND "relevance_score" >= ${RELEVANT_IDEA_THRESHOLD})
              AS "previous_relevantIdeas",

            (SELECT COUNT(*) FROM "saved_items"
               WHERE "user_id" = ${userId}
                 AND "created_at" >= ${current.from} AND "created_at" < ${current.to})
              AS "savedItems",
            (SELECT COUNT(*) FROM "saved_items"
               WHERE "user_id" = ${userId}
                 AND "created_at" >= ${previous.from} AND "created_at" < ${previous.to})
              AS "previous_savedItems",

            (SELECT COUNT(*) FROM "topics"
               WHERE "status" = 'ACTIVE' AND "classification" = 'EMERGING_TREND'
                 AND "last_detected_at" >= ${current.from})
              AS "emergingTrends",
            (SELECT COUNT(*) FROM "topics"
               WHERE "status" = 'ACTIVE' AND "classification" = 'EMERGING_TREND'
                 AND "last_detected_at" >= ${previous.from} AND "last_detected_at" < ${previous.to})
              AS "previous_emergingTrends",

            (SELECT COUNT(*) FROM "topics"
               WHERE "status" = 'ACTIVE' AND "arabic_opportunity_score" >= 70
                 AND "last_detected_at" >= ${current.from})
              AS "arabicOpportunities",
            (SELECT COUNT(*) FROM "topics"
               WHERE "status" = 'ACTIVE' AND "arabic_opportunity_score" >= 70
                 AND "last_detected_at" >= ${previous.from} AND "last_detected_at" < ${previous.to})
              AS "previous_arabicOpportunities"
        `;

        const row = rows[0];
        const keys: KpiKey[] = [
          'newTopics',
          'newPosts',
          'relevantIdeas',
          'savedItems',
          'emergingTrends',
          'arabicOpportunities',
        ];

        return keys.map((key) => {
          const value = Number(row?.[key] ?? 0);
          const previousValue = Number(row?.[`previous_${key}`] ?? 0);
          return {
            key,
            value,
            previousValue,
            changePercentage: percentageChange(value, previousValue),
          };
        });
      });
    },

    /** Trending topics with a sparkline drawn from their snapshot history. */
    async loadTrendingTopics(
      range: AnalyticsRange,
      limit: number,
      now: Date,
    ): Promise<TrendingTopicSummary[]> {
      const window = windowForRange(range, now);

      return withDatabaseErrors('Dashboard', async () => {
        const topics = await client.topic.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, postCount: true, trendScore: true },
          orderBy: [{ trendScore: 'desc' }, { lastDetectedAt: 'desc' }],
          take: Math.max(1, Math.min(50, limit)),
        });
        if (topics.length === 0) return [];

        const snapshots = await client.trendSnapshot.findMany({
          where: {
            topicId: { in: topics.map((topic) => topic.id) },
            recordedAt: { gte: window.from },
          },
          select: { topicId: true, trendScore: true, postCount: true, recordedAt: true },
          orderBy: { recordedAt: 'asc' },
        });

        const byTopic = new Map<string, { trendScore: number; postCount: number }[]>();
        for (const snapshot of snapshots) {
          const list = byTopic.get(snapshot.topicId) ?? [];
          list.push({ trendScore: snapshot.trendScore, postCount: snapshot.postCount });
          byTopic.set(snapshot.topicId, list);
        }

        return topics.map((topic, index) => {
          const history = byTopic.get(topic.id) ?? [];
          const first = history[0];
          const last = history[history.length - 1];
          return {
            rank: index + 1,
            topicId: topic.id,
            name: topic.name,
            postCount: topic.postCount,
            growthPercentage:
              first === undefined || last === undefined
                ? null
                : percentageChange(last.postCount, first.postCount),
            trendScore: topic.trendScore,
            sparkline: history.map((entry) => entry.trendScore),
          };
        });
      });
    },

    async loadSourceDistribution(
      range: AnalyticsRange,
      now: Date,
    ): Promise<SourceDistributionSlice[]> {
      const window = windowForRange(range, now);
      return withDatabaseErrors('Dashboard', async () => {
        const grouped = await client.post.groupBy({
          by: ['source'],
          where: { collectedAt: { gte: window.from }, isHidden: false },
          _count: { _all: true },
        });
        return toSourceDistribution(
          grouped.map((entry) => ({ source: entry.source, count: entry._count._all })),
        );
      });
    },

    /**
     * The activity chart.
     *
     * Buckets are generated in SQL so an interval with no activity appears as a
     * zero. Filling gaps afterwards in JavaScript is where "the chart looks
     * fine but skips Tuesday" bugs come from.
     */
    async loadActivity(range: AnalyticsRange, now: Date): Promise<ActivityBucket[]> {
      const window = windowForRange(range, now);
      const bucketHours = ANALYTICS_RANGE_BUCKET_HOURS[range];
      const buckets = bucketStarts(window, bucketHours);
      if (buckets.length === 0) return [];

      const from = buckets[0] ?? window.from;
      const interval = `${String(bucketHours)} hours`;

      return withDatabaseErrors('Dashboard', async () => {
        const rows = await client.$queryRaw<
          {
            bucket_start: Date;
            posts_collected: bigint;
            relevant_ideas: bigint;
            topics_created: bigint;
            translations: bigint;
          }[]
        >`
          WITH buckets AS (
            SELECT generate_series(
              ${from}::timestamptz,
              ${window.to}::timestamptz,
              ${interval}::interval
            ) AS bucket_start
          )
          SELECT
            b.bucket_start,
            COALESCE(p.total, 0)          AS posts_collected,
            COALESCE(p.relevant, 0)       AS relevant_ideas,
            COALESCE(t.total, 0)          AS topics_created,
            COALESCE(tr.total, 0)         AS translations
          FROM buckets b
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE "relevance_score" >= ${RELEVANT_IDEA_THRESHOLD}) AS relevant
            FROM "posts"
            WHERE "is_hidden" = false
              AND "collected_at" >= b.bucket_start
              AND "collected_at" <  b.bucket_start + ${interval}::interval
          ) p ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS total FROM "topics"
            WHERE "created_at" >= b.bucket_start
              AND "created_at" <  b.bucket_start + ${interval}::interval
          ) t ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS total FROM "translations"
            WHERE "created_at" >= b.bucket_start
              AND "created_at" <  b.bucket_start + ${interval}::interval
          ) tr ON TRUE
          ORDER BY b.bucket_start ASC
        `;

        return rows.map((row) => ({
          bucketStart: row.bucket_start.toISOString(),
          postsCollected: Number(row.posts_collected),
          relevantIdeas: Number(row.relevant_ideas),
          topicsCreated: Number(row.topics_created),
          translations: Number(row.translations),
        }));
      });
    },

    /** Total posts held, for the source-distribution card's caption. */
    async countPosts(): Promise<number> {
      return withDatabaseErrors('Dashboard', () =>
        client.post.count({ where: { isHidden: false } }),
      );
    },

    /** A bucketed count for one report kind, over an explicit range. */
    async loadReportSeries(input: {
      table: 'posts' | 'topics' | 'translations' | 'content_drafts';
      from: Date;
      to: Date;
      bucketHours: number;
    }): Promise<{ label: string; value: number }[]> {
      // The table name is chosen from a closed set here, never from a request.
      const timestampColumn = input.table === 'posts' ? 'collected_at' : 'created_at';
      const interval = `${String(Math.max(1, input.bucketHours))} hours`;

      return withDatabaseErrors('Report', async () => {
        const rows = await client.$queryRawUnsafe<{ bucket_start: Date; total: bigint }[]>(
          `
          WITH buckets AS (
            SELECT generate_series($1::timestamptz, $2::timestamptz, $3::interval) AS bucket_start
          )
          SELECT b.bucket_start, COALESCE(c.total, 0) AS total
          FROM buckets b
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS total FROM "${input.table}"
            WHERE "${timestampColumn}" >= b.bucket_start
              AND "${timestampColumn}" <  b.bucket_start + $3::interval
          ) c ON TRUE
          ORDER BY b.bucket_start ASC
          `,
          input.from,
          input.to,
          interval,
        );

        return rows.map((row) => ({
          label: row.bucket_start.toISOString(),
          value: Number(row.total),
        }));
      });
    },

    /** Hours covered by an analytics range, for callers that need the window. */
    rangeHours(range: AnalyticsRange): number {
      return ANALYTICS_RANGE_HOURS[range];
    },
  };
}

export type AnalyticsRepository = ReturnType<typeof createAnalyticsRepository>;
