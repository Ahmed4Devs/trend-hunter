import type { TopicSortField } from '@trendhunter/database';
import {
  ANALYTICS_RANGE_BUCKET_HOURS,
  ANALYTICS_RANGE_HOURS,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  NotFoundError,
  ValidationError,
} from '@trendhunter/shared';
import { ANALYTICS_RANGES, type AnalyticsRange, type ReportKind } from '@trendhunter/types';
import {
  createScanBodySchema,
  generateReportBodySchema,
  idParamSchema,
  listJobsQuerySchema,
  listReportsQuerySchema,
  listScansQuerySchema,
  updateProfileBodySchema,
  updateUserSettingsBodySchema,
} from '@trendhunter/validation';
import { z } from 'zod';

import {
  commonErrorResponses,
  notFoundResponse,
  ok,
  paginated,
  paginatedEnvelope,
  successEnvelope,
} from '../http/envelope';
import { currentUser, expensive, type RouteModule } from '../http/route';
import {
  authenticatedUserSchema,
  jobRunSchema,
  reportSchema,
  scanRunSchema,
  userSettingsSchema,
} from '../http/schemas';

/**
 * Operations, reports and settings.
 *
 * Three surfaces that share one property: they are all about the deployment's
 * own state rather than about collected content. Scans and jobs are the
 * operator's window onto the pipeline, reports are aggregates over it, and
 * settings are the caller's own row — which is why every report and settings
 * query below is scoped by the session's user id inside the repository rather
 * than filtered after the fact.
 */

/**
 * How long a manual scan is treated as "already running".
 *
 * A double-clicked button, a retried request and an impatient second tab all
 * arrive within seconds of each other, and each one would otherwise cost a full
 * pass over every provider. The window only ever matches a scan that is still
 * PENDING or RUNNING, so it delays nothing once a scan has finished.
 */
const MANUAL_SCAN_DEDUPLICATION_WINDOW_MS = 2 * MILLISECONDS_PER_MINUTE;

/** Rows considered by the ranked (non-temporal) report kinds. */
const REPORT_RANKING_LIMIT = 25;

/** Most recent scans a scan-history report looks back over. */
const REPORT_SCAN_HISTORY_LIMIT = 100;

/**
 * A point in a report.
 *
 * A type literal rather than an interface, and so not `ReportSeriesPoint` from
 * `@trendhunter/types`: only a type literal gains the implicit index signature
 * that makes it assignable to Prisma's JSON input type, and the alternative is
 * a cast on every persisted payload.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see above
type ReportPoint = {
  readonly label: string;
  readonly value: number;
  readonly secondaryValue?: number;
};

const REPORT_TITLES: Readonly<Record<ReportKind, string>> = {
  POSTS_COLLECTED: 'Posts collected',
  TOPICS_DETECTED: 'Topics detected',
  SOURCE_DISTRIBUTION: 'Source distribution',
  TREND_GROWTH: 'Trend growth',
  TOP_CATEGORIES: 'Top categories',
  ARABIC_OPPORTUNITIES: 'Arabic opportunities',
  TRANSLATION_ACTIVITY: 'Translation activity',
  CONTENT_GENERATION: 'Content generation',
  SCAN_HISTORY: 'Scan history',
};

/** Table each bucketed report kind counts rows in. Never taken from a request. */
const REPORT_SERIES_TABLES = {
  POSTS_COLLECTED: 'posts',
  TOPICS_DETECTED: 'topics',
  TRANSLATION_ACTIVITY: 'translations',
  CONTENT_GENERATION: 'content_drafts',
} as const;

/**
 * The narrowest preset range that still covers `spanHours`.
 *
 * The report body carries an arbitrary window, but the analytics aggregates are
 * calibrated against the four presets — this maps one onto the other so a
 * fourteen-day report is bucketed like a thirty-day one rather than into
 * hundreds of unreadable points.
 */
function analyticsRangeFor(spanHours: number): AnalyticsRange {
  return ANALYTICS_RANGES.find((range) => ANALYTICS_RANGE_HOURS[range] >= spanHours) ?? '90d';
}

function sumValues(points: readonly ReportPoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

export const operationRoutes: RouteModule = (app) => {
  const { queues, repositories } = app.container;

  // ---------------------------------------------------------------------
  // Scans
  // ---------------------------------------------------------------------

  app.route({
    method: 'POST',
    url: '/scans',
    config: expensive(app.container.env),
    schema: {
      operationId: 'createScan',
      tags: ['operations'],
      summary: 'Start a collection run',
      description:
        'Enqueues one collection job per enabled source and answers immediately with the scan run. Collection cannot happen inside the request: five providers, each rate limited and retried, take minutes and would be lost if the client disconnected. Answers 200 with the scan already in flight when one was started moments ago.',
      body: createScanBodySchema,
      response: {
        200: successEnvelope(scanRunSchema).describe('A manual scan was already running.'),
        202: successEnvelope(scanRunSchema).describe('The scan was accepted and enqueued.'),
        ...commonErrorResponses,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;

      const since = new Date(Date.now() - MANUAL_SCAN_DEDUPLICATION_WINDOW_MS);
      const inFlight = await repositories.operations.findRecentManualScan(session.user.id, since);
      // Returning the running scan rather than a 409 keeps the button idempotent
      // from the client's point of view: it polls the same id either way.
      if (inFlight !== null) return reply.code(200).send(ok(inFlight));

      const enabled = await repositories.sources.listEnabled();
      const requested = body.sources;
      const sources =
        requested === undefined
          ? enabled
          : enabled.filter((source) => requested.includes(source.kind));

      // An empty selection would create a scan that no worker ever finishes, so
      // it is rejected rather than recorded as a run that never progresses.
      if (sources.length === 0) {
        throw new ValidationError('No enabled source matches the requested selection.');
      }

      const scanRun = await repositories.operations.createScanRun({
        userId: session.user.id,
        trigger: 'MANUAL',
        sourceKinds: sources.map((source) => source.kind),
      });

      // The scan run exists before the jobs are enqueued so that every job can
      // report its counters into a row that is already there.
      await queues.enqueueScan({
        scanRunId: scanRun.id,
        sources: sources.map((source) => ({ id: source.id, kind: source.kind })),
        limit: body.limit,
        // The collectors decide their own lower bound from what they already
        // hold; a bound chosen here would re-fetch or skip depending on how long
        // the job waited in the queue.
        since: null,
      });

      return reply.code(202).send(ok(scanRun));
    },
  });

  app.route({
    method: 'GET',
    url: '/scans',
    schema: {
      operationId: 'listScans',
      tags: ['operations'],
      summary: 'List collection runs',
      querystring: listScansQuerySchema,
      response: { 200: paginatedEnvelope(scanRunSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      currentUser(request);
      const query = request.query;
      const result = await repositories.operations.listScanRuns({
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/scans/:id',
    schema: {
      operationId: 'getScan',
      tags: ['operations'],
      summary: 'Get one collection run',
      params: idParamSchema,
      response: {
        200: successEnvelope(scanRunSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const scanRun = await repositories.operations.findScanRun(request.params.id);
      if (scanRun === null) throw new NotFoundError('Scan run');
      return ok(scanRun);
    },
  });

  app.route({
    method: 'GET',
    url: '/jobs',
    schema: {
      operationId: 'listJobs',
      tags: ['operations'],
      summary: 'List job attempts',
      description:
        'One row per attempt, so a job that failed twice before succeeding shows all three — the history is what explains a failure rather than merely reporting it.',
      querystring: listJobsQuerySchema,
      response: { 200: paginatedEnvelope(jobRunSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      currentUser(request);
      const query = request.query;
      const result = await repositories.operations.listJobRuns({
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.queue === undefined ? {} : { queue: query.queue }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.scanRunId === undefined ? {} : { scanRunId: query.scanRunId }),
      });
      return paginated(result.items, result.pagination);
    },
  });

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------

  app.route({
    method: 'POST',
    url: '/reports',
    schema: {
      operationId: 'generateReport',
      tags: ['reports'],
      summary: 'Generate and store a report',
      description:
        'Computed in the request and persisted. These are aggregate queries against PostgreSQL, not provider calls, so there is nothing to queue — and a report the caller cannot read back immediately is a worse product for no gain. `series` carries values over time and `breakdown` carries them by category; a report kind fills whichever of the two it is about.',
      body: generateReportBodySchema,
      response: {
        201: successEnvelope(reportSchema),
        ...commonErrorResponses,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;

      const from = new Date(body.range.from);
      const to = new Date(body.range.to);
      const range = analyticsRangeFor((to.getTime() - from.getTime()) / MILLISECONDS_PER_HOUR);

      // Recorded on the report so a stored result stays interpretable, even
      // where the underlying aggregate cannot honour every one of them.
      const filters = {
        from: body.range.from,
        to: body.range.to,
        ...(body.sources === undefined ? {} : { sources: body.sources }),
        ...(body.topicIds === undefined ? {} : { topicIds: body.topicIds }),
        ...(body.languages === undefined ? {} : { languages: body.languages }),
      };

      const topicFilters = {
        ...(body.sources === undefined ? {} : { sources: body.sources }),
        ...(body.topicIds === undefined ? {} : { ids: body.topicIds }),
      };
      const rankTopics = (sortBy: TopicSortField) =>
        repositories.topics.list({
          filters: topicFilters,
          pagination: { page: 1, pageSize: REPORT_RANKING_LIMIT },
          sortBy,
          sortDirection: 'desc',
        });

      let series: readonly ReportPoint[] = [];
      let breakdown: readonly ReportPoint[] = [];
      let total = 0;

      switch (body.kind) {
        case 'POSTS_COLLECTED':
        case 'TOPICS_DETECTED':
        case 'TRANSLATION_ACTIVITY':
        case 'CONTENT_GENERATION': {
          series = await repositories.analytics.loadReportSeries({
            table: REPORT_SERIES_TABLES[body.kind],
            from,
            to,
            bucketHours: ANALYTICS_RANGE_BUCKET_HOURS[range],
          });
          total = sumValues(series);
          break;
        }

        case 'SOURCE_DISTRIBUTION': {
          // The aggregate measures back from a moment rather than between two,
          // so the report's window is expressed as its end plus the nearest
          // preset length.
          const slices = await repositories.analytics.loadSourceDistribution(range, to);
          breakdown = slices.map((slice) => ({
            label: slice.source,
            value: slice.count,
            secondaryValue: slice.percentage,
          }));
          total = sumValues(breakdown);
          break;
        }

        case 'TREND_GROWTH': {
          // Topic rankings describe the present state of a topic, which has no
          // per-window variant to query: the range is recorded, not applied.
          const page = await rankTopics('velocity');
          breakdown = page.items.map((topic) => ({
            label: topic.name,
            value: topic.velocity,
            secondaryValue: topic.trendScore,
          }));
          total = page.pagination.totalItems;
          break;
        }

        case 'ARABIC_OPPORTUNITIES': {
          const page = await rankTopics('arabicOpportunityScore');
          breakdown = page.items.map((topic) => ({
            label: topic.name,
            value: topic.arabicOpportunityScore,
            secondaryValue: topic.arabicPostCount,
          }));
          total = page.pagination.totalItems;
          break;
        }

        case 'TOP_CATEGORIES': {
          const page = await rankTopics('postCount');
          breakdown = page.items.map((topic) => ({
            label: topic.name,
            value: topic.postCount,
            secondaryValue: topic.trendScore,
          }));
          total = page.pagination.totalItems;
          break;
        }

        case 'SCAN_HISTORY': {
          // Scan runs are not queryable by date, so the most recent page is
          // narrowed here. That bounds the report to the last hundred runs,
          // which is far more than any window this report is asked for.
          const page = await repositories.operations.listScanRuns({
            pagination: { page: 1, pageSize: REPORT_SCAN_HISTORY_LIMIT },
          });
          // Compared as instants, not as strings: the request's bounds are
          // validated with `offset: true`, so `2026-01-01T00:00:00+03:00` is a
          // legal `from` and would sort nonsensically against the stored UTC
          // form of `startedAt`.
          const fromMs = from.getTime();
          const toMs = to.getTime();
          series = page.items
            .filter((run) => {
              const startedAt = Date.parse(run.startedAt);
              return startedAt >= fromMs && startedAt <= toMs;
            })
            .map((run) => ({
              label: run.startedAt,
              value: run.itemsStored,
              secondaryValue: run.postsCreated,
            }));
          total = series.length;
          break;
        }
      }

      const title = REPORT_TITLES[body.kind];
      const report = await repositories.users.createReport({
        userId: session.user.id,
        kind: body.kind,
        title,
        rangeFrom: from,
        rangeTo: to,
        filters,
        payload: {
          kind: body.kind,
          title,
          filters,
          generatedAt: new Date().toISOString(),
          total,
          series,
          breakdown,
        },
      });

      return reply.code(201).send(ok(report));
    },
  });

  app.route({
    method: 'GET',
    url: '/reports',
    schema: {
      operationId: 'listReports',
      tags: ['reports'],
      summary: "List the caller's reports",
      querystring: listReportsQuerySchema,
      response: { 200: paginatedEnvelope(reportSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;
      const result = await repositories.users.listReports(session.user.id, {
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.kind === undefined ? {} : { kind: query.kind }),
      });
      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/reports/:id',
    schema: {
      operationId: 'getReport',
      tags: ['reports'],
      summary: 'Get one report',
      params: idParamSchema,
      response: {
        200: successEnvelope(reportSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const report = await repositories.users.findReport(session.user.id, request.params.id);
      // Scoped in the query, so another user's report is indistinguishable from
      // one that does not exist.
      if (report === null) throw new NotFoundError('Report');
      return ok(report);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/reports/:id',
    schema: {
      operationId: 'deleteReport',
      tags: ['reports'],
      summary: 'Delete a report',
      params: idParamSchema,
      response: {
        204: z.null().describe('The report was deleted.'),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const deleted = await repositories.users.deleteReport(session.user.id, request.params.id);
      if (!deleted) throw new NotFoundError('Report');
      return reply.code(204).send(null);
    },
  });

  // ---------------------------------------------------------------------
  // Settings and profile
  // ---------------------------------------------------------------------

  app.route({
    method: 'GET',
    url: '/settings',
    schema: {
      operationId: 'getSettings',
      tags: ['settings'],
      summary: "Get the caller's preferences",
      description:
        'A user who has never opened this screen still has preferences; the row is created on first read so that the first write cannot discard defaults the user never saw.',
      response: { 200: successEnvelope(userSettingsSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      return ok(await repositories.users.loadSettings(session.user.id));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/settings',
    schema: {
      operationId: 'updateSettings',
      tags: ['settings'],
      summary: "Update the caller's preferences",
      body: updateUserSettingsBodySchema,
      response: { 200: successEnvelope(userSettingsSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      return ok(await repositories.users.updateSettings(session.user.id, request.body));
    },
  });

  app.route({
    method: 'GET',
    url: '/settings/profile',
    schema: {
      operationId: 'getProfile',
      tags: ['settings'],
      summary: "Get the caller's profile",
      response: {
        200: successEnvelope(authenticatedUserSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const profile = await repositories.users.findProfile(session.user.id);
      // A live session whose user row has gone is a deleted account, not a 500.
      if (profile === null) throw new NotFoundError('User');
      return ok(profile);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/settings/profile',
    schema: {
      operationId: 'updateProfile',
      tags: ['settings'],
      summary: "Update the caller's display name or avatar",
      description:
        'Only the display name and avatar. Email and role are credentials, changed through the auth endpoints and never through a profile patch.',
      body: updateProfileBodySchema,
      response: {
        200: successEnvelope(authenticatedUserSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const profile = await repositories.users.updateProfile(session.user.id, request.body);
      if (profile === null) throw new NotFoundError('User');
      return ok(profile);
    },
  });

  app.route({
    method: 'GET',
    url: '/settings/me',
    schema: {
      operationId: 'getCurrentUser',
      tags: ['settings'],
      summary: 'The authenticated caller',
      description:
        'Answered from the session the auth plugin already resolved, so the web app can render its shell — and decide whether to show operator-only navigation — without a second round trip.',
      response: { 200: successEnvelope(authenticatedUserSchema), ...commonErrorResponses },
    },
    handler: (request) => ok(currentUser(request).user),
  });

  return Promise.resolve();
};
