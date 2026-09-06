import { checkDatabaseHealth } from '@trendhunter/database';
import {
  subtractHours,
  windowForRange,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from '@trendhunter/shared';
import {
  ANALYTICS_RANGES,
  KPI_KEYS,
  type AnalyticsRange,
  type ApiUsageSummary,
  type SystemHealthSummary,
} from '@trendhunter/types';
import { dashboardQuerySchema } from '@trendhunter/validation';
import { z } from 'zod';

import { commonErrorResponses, ok, readonlyArray, successEnvelope } from '../http/envelope';
import { currentUser, type RouteModule } from '../http/route';
import {
  apiUsageSummarySchema,
  postSchema,
  registered,
  sourceDistributionSchema,
} from '../http/schemas';

const isoDateTime = z.iso.datetime();

const kpiCardSchema = registered(
  'KpiCard',
  z.object({
    key: z.enum(KPI_KEYS),
    value: z.number(),
    previousValue: z.number(),
    changePercentage: z.number().nullable(),
  }),
);

const trendingTopicSummarySchema = registered(
  'TrendingTopicSummary',
  z.object({
    rank: z.number().int(),
    topicId: z.string(),
    name: z.string(),
    postCount: z.number().int(),
    growthPercentage: z.number().nullable(),
    trendScore: z.number(),
    sparkline: readonlyArray(z.number()),
  }),
);

const activityBucketSchema = registered(
  'ActivityBucket',
  z.object({
    bucketStart: isoDateTime,
    postsCollected: z.number().int(),
    relevantIdeas: z.number().int(),
    topicsCreated: z.number().int(),
    translations: z.number().int(),
  }),
);

const systemHealthSummarySchema = registered(
  'SystemHealthSummary',
  z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
    worker: z.enum(['up', 'stale', 'down']),
    workerLastHeartbeatAt: isoDateTime.nullable(),
    queueDepth: z.number().int(),
    failedJobs24h: z.number().int(),
  }),
);

const dashboardSummarySchema = registered(
  'DashboardSummary',
  z.object({
    range: z.enum(ANALYTICS_RANGES),
    generatedAt: isoDateTime,
    kpis: readonlyArray(kpiCardSchema),
    trendingTopics: readonlyArray(trendingTopicSummarySchema),
    sourceDistribution: readonlyArray(sourceDistributionSchema),
    totalPosts: z.number().int(),
    recentPosts: readonlyArray(postSchema),
    activity: readonlyArray(activityBucketSchema),
    apiUsage: readonlyArray(apiUsageSummarySchema),
    health: systemHealthSummarySchema,
  }),
);

/** Trending topics shown on the dashboard; the full list lives under `/trends`. */
const TRENDING_TOPIC_COUNT = 5;

/** Posts in the "latest" panel. Small enough to stay above the fold. */
const RECENT_POST_COUNT = 8;

const FAILED_JOB_WINDOW_HOURS = 24;

export const dashboardRoutes: RouteModule = (app) => {
  const { database, redis, queues, repositories } = app.container;

  app.route({
    method: 'GET',
    url: '/dashboard',
    schema: {
      operationId: 'getDashboard',
      tags: ['dashboard'],
      summary: 'Everything the dashboard page renders',
      description:
        'KPIs, trending topics, source mix, recent posts, the activity series, provider usage and system health for one analytics range.',
      querystring: dashboardQuerySchema,
      response: { 200: successEnvelope(dashboardSummarySchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const { range } = request.query;

      // One clock for the whole aggregate: calling `new Date()` per query would
      // let the KPI window and the activity series disagree about where "now"
      // is, which surfaces as a final bucket that does not match its card.
      const now = new Date();

      const [
        kpis,
        trendingTopics,
        sourceDistribution,
        totalPosts,
        recentPosts,
        activity,
        apiUsage,
        health,
      ] = await Promise.all([
        repositories.analytics.loadKpis(range, session.user.id, now),
        repositories.analytics.loadTrendingTopics(range, TRENDING_TOPIC_COUNT, now),
        repositories.analytics.loadSourceDistribution(range, now),
        repositories.analytics.countPosts(),
        repositories.posts.list(
          {
            pagination: { page: 1, pageSize: RECENT_POST_COUNT },
            // Collection order, not publication order: the panel answers "what
            // has just arrived", and a backfilled week-old post is not news.
            sortBy: 'collectedAt',
            sortDirection: 'desc',
            filters: { includeHidden: false },
          },
          // The panel renders a save button per row, so it needs the caller's
          // own saved state rather than the deployment's.
          session.user.id,
        ),
        repositories.analytics.loadActivity(range, now),
        loadApiUsage(range, now),
        loadHealth(now),
      ]);

      return ok({
        range,
        generatedAt: now.toISOString(),
        kpis,
        trendingTopics,
        sourceDistribution,
        totalPosts,
        recentPosts: recentPosts.items,
        activity,
        apiUsage,
        health,
      });
    },
  });

  app.route({
    method: 'GET',
    url: '/dashboard/usage',
    schema: {
      operationId: 'getDashboardUsage',
      tags: ['operations'],
      summary: 'Provider usage totals for the usage widget',
      description:
        'The same figures as the `apiUsage` field of `GET /dashboard`, so the widget can refresh on its own cadence without re-running every dashboard query.',
      querystring: dashboardQuerySchema,
      response: {
        200: successEnvelope(readonlyArray(apiUsageSummarySchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      currentUser(request);
      return ok(await loadApiUsage(request.query.range, new Date()));
    },
  });

  /**
   * Provider usage over the requested window.
   *
   * This deployment configures no provider quota, so the quota fields are null
   * rather than a guess: an invented ceiling renders as a progress bar that
   * means nothing.
   */
  async function loadApiUsage(range: AnalyticsRange, now: Date): Promise<ApiUsageSummary[]> {
    const window = windowForRange(range, now);
    const rows = await repositories.operations.summariseApiUsage(window.from);
    return rows.map((row) => ({ ...row, quotaLimit: null, quotaUsedPercentage: null }));
  }

  async function loadHealth(now: Date): Promise<SystemHealthSummary> {
    const [databaseHealth, redisStatus, worker, queueDepth, failedJobs24h] = await Promise.all([
      checkDatabaseHealth(database),
      checkRedis(),
      checkWorker(now),
      countQueued(),
      repositories.operations.countFailedJobsSince(subtractHours(now, FAILED_JOB_WINDOW_HOURS)),
    ]);

    return {
      database: databaseHealth.ok ? 'up' : 'down',
      redis: redisStatus,
      worker: worker.status,
      workerLastHeartbeatAt: worker.lastHeartbeatAt,
      queueDepth,
      failedJobs24h,
    };
  }

  async function checkRedis(): Promise<SystemHealthSummary['redis']> {
    try {
      await redis.ping();
      return 'up';
    } catch {
      // The failure reason can name the host, so it stays in the log rather
      // than in a response body.
      return 'down';
    }
  }

  async function checkWorker(now: Date): Promise<{
    status: SystemHealthSummary['worker'];
    lastHeartbeatAt: string | null;
  }> {
    try {
      const beat = await redis.get(WORKER_HEARTBEAT_KEY);
      if (beat === null) return { status: 'down', lastHeartbeatAt: null };

      // A missing worker and a corrupt key are the same answer: `down`. An
      // empty string coerces to 0, which would otherwise be reported as a
      // heartbeat from 1970 rather than as no heartbeat at all.
      const recordedAt = Number(beat);
      if (!Number.isFinite(recordedAt) || recordedAt <= 0) {
        return { status: 'down', lastHeartbeatAt: null };
      }

      const ageSeconds = (now.getTime() - recordedAt) / 1000;
      return {
        status: ageSeconds <= WORKER_HEARTBEAT_TTL_SECONDS ? 'up' : 'stale',
        lastHeartbeatAt: new Date(recordedAt).toISOString(),
      };
    } catch {
      return { status: 'down', lastHeartbeatAt: null };
    }
  }

  /**
   * Waiting plus active jobs across every queue.
   *
   * Failed jobs are excluded: they are reported separately and are not work
   * still owed. A Redis outage reports zero instead of failing the request —
   * the `redis` field already tells the widget the figure is untrustworthy, and
   * everything else on the dashboard comes from PostgreSQL and is still valid.
   */
  async function countQueued(): Promise<number> {
    try {
      const counts = await queues.counts();
      return counts.reduce((total, entry) => total + entry.waiting + entry.active, 0);
    } catch {
      return 0;
    }
  }

  return Promise.resolve();
};
