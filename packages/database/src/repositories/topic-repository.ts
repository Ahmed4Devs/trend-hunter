import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '@trendhunter/shared';
import type {
  ArabicOpportunityBreakdown,
  Paginated,
  PaginationParams,
  SortDirection,
  SourceDistributionSlice,
  SourceKind,
  Topic,
  TopicClassification,
  TopicDetail,
  TopicSignalExplanation,
  TopicStatus,
  TrendScoreBreakdown,
} from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { type Prisma } from '../client';
import { withDatabaseErrors } from '../errors';
import {
  POST_SELECT,
  TOPIC_SELECT,
  TREND_SNAPSHOT_SELECT,
  toPost,
  toSourceDistribution,
  toTopic,
  toTopicArabicBreakdown,
  toTopicTrendBreakdown,
  toTrendSnapshot,
} from '../mappers';
import { loadSavedPostIds } from './saved-flags';

/**
 * Topic reads and writes.
 *
 * The source kinds behind a topic are not a column: they are derived from its
 * posts. Storing them would mean maintaining a denormalised array on every
 * ingest, and it would drift the moment a post is deleted. They are loaded in
 * one grouped query for the whole page instead — which is also what keeps the
 * list endpoint free of the N+1 that a naive `include: { posts: true }` causes.
 */

export interface TopicListFilters {
  readonly status?: TopicStatus;
  readonly classifications?: readonly TopicClassification[];
  readonly sources?: readonly SourceKind[];
  readonly minTrend?: number;
  readonly minOpportunity?: number;
  readonly savedByUserId?: string;
  readonly ids?: readonly string[];
}

export type TopicSortField =
  | 'trendScore'
  | 'relevanceScore'
  | 'arabicOpportunityScore'
  | 'postCount'
  | 'velocity'
  | 'firstDetectedAt'
  | 'lastDetectedAt';

export interface TopicListOptions {
  readonly filters?: TopicListFilters;
  readonly pagination?: Partial<PaginationParams>;
  readonly sortBy?: TopicSortField;
  readonly sortDirection?: SortDirection;
}

function buildWhere(filters: TopicListFilters = {}): Prisma.TopicWhereInput {
  const where: Prisma.TopicWhereInput = {};

  where.status = filters.status ?? 'ACTIVE';
  if (filters.classifications && filters.classifications.length > 0) {
    where.classification = { in: [...filters.classifications] };
  }
  if (filters.minTrend !== undefined) where.trendScore = { gte: filters.minTrend };
  if (filters.minOpportunity !== undefined) {
    where.arabicOpportunityScore = { gte: filters.minOpportunity };
  }
  if (filters.ids !== undefined) where.id = { in: [...filters.ids] };
  if (filters.sources && filters.sources.length > 0) {
    where.posts = { some: { source: { in: [...filters.sources] } } };
  }
  if (filters.savedByUserId !== undefined) {
    where.savedItems = { some: { userId: filters.savedByUserId } };
  }

  return where;
}

/**
 * Narrows a domain value to Prisma's JSON input type.
 *
 * The domain interfaces are structurally JSON-compatible but do not carry the
 * index signature Prisma's union requires, so the conversion goes through
 * `unknown`. Confined to this one helper rather than scattered as casts.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Loads source kinds and saved flags for a page of topics in two queries. */
async function loadTopicExtras(
  client: PrismaClient,
  topicIds: readonly string[],
  userId: string | null,
): Promise<{
  sourcesByTopic: Map<string, SourceKind[]>;
  savedTopicIds: Set<string>;
}> {
  if (topicIds.length === 0) {
    return { sourcesByTopic: new Map(), savedTopicIds: new Set() };
  }

  const [sourceRows, savedRows] = await Promise.all([
    client.post.groupBy({
      by: ['topicId', 'source'],
      where: { topicId: { in: [...topicIds] } },
      _count: { _all: true },
    }),
    userId === null
      ? Promise.resolve([])
      : client.savedItem.findMany({
          where: { userId, topicId: { in: [...topicIds] } },
          select: { topicId: true },
        }),
  ]);

  const sourcesByTopic = new Map<string, SourceKind[]>();
  for (const row of sourceRows) {
    if (row.topicId === null) continue;
    const existing = sourcesByTopic.get(row.topicId) ?? [];
    existing.push(row.source);
    sourcesByTopic.set(row.topicId, existing);
  }

  const savedTopicIds = new Set(
    savedRows.map((row) => row.topicId).filter((id): id is string => id !== null),
  );

  return { sourcesByTopic, savedTopicIds };
}

export function createTopicRepository(client: PrismaClient) {
  return {
    async list(
      options: TopicListOptions = {},
      userId: string | null = null,
    ): Promise<Paginated<Topic>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = buildWhere(options.filters);
      const sortBy = options.sortBy ?? 'trendScore';
      const direction = options.sortDirection ?? 'desc';

      return withDatabaseErrors('Topic', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.topic.findMany({
            where,
            select: TOPIC_SELECT,
            orderBy: [{ [sortBy]: direction }, { id: 'asc' }],
            skip,
            take,
          }),
          client.topic.count({ where }),
        ]);

        const { sourcesByTopic, savedTopicIds } = await loadTopicExtras(
          client,
          rows.map((row) => row.id),
          userId,
        );

        return {
          items: rows.map((row) =>
            toTopic(row, {
              sourceKinds: sourcesByTopic.get(row.id) ?? [],
              isSaved: savedTopicIds.has(row.id),
            }),
          ),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async findById(id: string, userId: string | null = null): Promise<Topic | null> {
      return withDatabaseErrors('Topic', async () => {
        const row = await client.topic.findUnique({ where: { id }, select: TOPIC_SELECT });
        if (row === null) return null;
        const { sourcesByTopic, savedTopicIds } = await loadTopicExtras(client, [id], userId);
        return toTopic(row, {
          sourceKinds: sourcesByTopic.get(id) ?? [],
          isSaved: savedTopicIds.has(id),
        });
      });
    },

    async findBySlug(slug: string): Promise<Topic | null> {
      return withDatabaseErrors('Topic', async () => {
        const row = await client.topic.findUnique({ where: { slug }, select: TOPIC_SELECT });
        return row === null ? null : toTopic(row);
      });
    },

    async findDetailById(
      id: string,
      options: { userId: string | null; snapshotsFrom?: Date; postLimit?: number },
    ): Promise<TopicDetail | null> {
      return withDatabaseErrors('Topic', async () => {
        const row = await client.topic.findUnique({ where: { id }, select: TOPIC_SELECT });
        if (row === null) return null;

        const [snapshots, posts, sourceCounts, extras] = await Promise.all([
          client.trendSnapshot.findMany({
            where: {
              topicId: id,
              ...(options.snapshotsFrom === undefined
                ? {}
                : { recordedAt: { gte: options.snapshotsFrom } }),
            },
            select: TREND_SNAPSHOT_SELECT,
            orderBy: { recordedAt: 'asc' },
            take: 500,
          }),
          client.post.findMany({
            where: { topicId: id, isHidden: false },
            select: POST_SELECT,
            orderBy: [{ trendScore: 'desc' }, { publishedAt: 'desc' }],
            take: Math.max(1, Math.min(100, options.postLimit ?? 25)),
          }),
          client.post.groupBy({
            by: ['source'],
            where: { topicId: id },
            _count: { _all: true },
          }),
          loadTopicExtras(client, [id], options.userId),
        ]);

        const breakdown: SourceDistributionSlice[] = toSourceDistribution(
          sourceCounts.map((entry) => ({ source: entry.source, count: entry._count._all })),
        );

        // Saved state for the posts on this page. Per user, like the topic's
        // own, so it is read from `saved_items` rather than from a column.
        const savedPostIds = await loadSavedPostIds(
          client,
          posts.map((post) => post.id),
          options.userId,
        );

        return {
          ...toTopic(row, {
            sourceKinds: extras.sourcesByTopic.get(id) ?? [],
            isSaved: extras.savedTopicIds.has(id),
          }),
          trendBreakdown: toTopicTrendBreakdown(row),
          arabicOpportunityBreakdown: toTopicArabicBreakdown(row),
          snapshots: snapshots.map(toTrendSnapshot),
          posts: posts.map((post) => toPost(post, { isSaved: savedPostIds.has(post.id) })),
          sourceBreakdown: breakdown,
        };
      });
    },

    /** Topics ordered by trend score, for the dashboard widget. */
    async findTrending(limit: number, userId: string | null = null): Promise<Topic[]> {
      return withDatabaseErrors('Topic', async () => {
        const rows = await client.topic.findMany({
          where: { status: 'ACTIVE' },
          select: TOPIC_SELECT,
          orderBy: [{ trendScore: 'desc' }, { lastDetectedAt: 'desc' }],
          take: Math.max(1, Math.min(50, limit)),
        });
        const { sourcesByTopic, savedTopicIds } = await loadTopicExtras(
          client,
          rows.map((row) => row.id),
          userId,
        );
        return rows.map((row) =>
          toTopic(row, {
            sourceKinds: sourcesByTopic.get(row.id) ?? [],
            isSaved: savedTopicIds.has(row.id),
          }),
        );
      });
    },

    async findByClassification(
      classification: TopicClassification,
      limit: number,
    ): Promise<Topic[]> {
      return withDatabaseErrors('Topic', async () => {
        const rows = await client.topic.findMany({
          where: { status: 'ACTIVE', classification },
          select: TOPIC_SELECT,
          orderBy:
            classification === 'HIDDEN_GEM'
              ? [{ arabicOpportunityScore: 'desc' }, { trendScore: 'desc' }]
              : [{ velocity: 'desc' }, { trendScore: 'desc' }],
          take: Math.max(1, Math.min(50, limit)),
        });
        const { sourcesByTopic } = await loadTopicExtras(
          client,
          rows.map((row) => row.id),
          null,
        );
        return rows.map((row) => toTopic(row, { sourceKinds: sourcesByTopic.get(row.id) ?? [] }));
      });
    },

    /**
     * Candidate topics for clustering: recent and active, with an embedding.
     *
     * Bounded by both time and count — a cluster decision that considered every
     * topic ever created would get slower every day and would happily merge a
     * new story into a year-old one.
     */
    async findClusterCandidates(options: {
      since: Date;
      limit: number;
    }): Promise<{ id: string; name: string; embedding: number[]; lastDetectedAt: Date }[]> {
      return withDatabaseErrors('Topic', async () => {
        const rows = await client.$queryRaw<
          { id: string; name: string; embedding: string; last_detected_at: Date }[]
        >`
          SELECT "id", "name", "embedding"::text AS "embedding", "last_detected_at"
          FROM "topics"
          WHERE "status" = 'ACTIVE'
            AND "embedding" IS NOT NULL
            AND "last_detected_at" >= ${options.since}
          ORDER BY "last_detected_at" DESC
          LIMIT ${Math.max(1, Math.min(2000, options.limit))}
        `;
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          embedding: JSON.parse(row.embedding) as number[],
          lastDetectedAt: row.last_detected_at,
        }));
      });
    },

    async create(data: {
      name: string;
      slug: string;
      summary?: string | null;
      normalizedName?: string | null;
      firstDetectedAt: Date;
      lastDetectedAt: Date;
    }): Promise<{ id: string }> {
      return withDatabaseErrors('Topic', () =>
        client.topic.create({
          data: {
            name: data.name,
            slug: data.slug,
            summary: data.summary ?? null,
            normalizedName: data.normalizedName ?? null,
            firstDetectedAt: data.firstDetectedAt,
            lastDetectedAt: data.lastDetectedAt,
          },
          select: { id: true },
        }),
      );
    },

    async updateScores(
      id: string,
      data: {
        trendScore: number;
        relevanceScore: number;
        velocity: number;
        arabicOpportunityScore: number;
        classification: TopicClassification;
        // Typed as the domain shapes rather than Prisma's JSON union: the cast
        // to `InputJsonValue` belongs here, at the persistence boundary, not in
        // every worker that computes a score.
        classificationReasons: readonly TopicSignalExplanation[];
        trendBreakdown: TrendScoreBreakdown;
        arabicOpportunityBreakdown: ArabicOpportunityBreakdown;
        postCount: number;
        commentCount: number;
        englishPostCount: number;
        arabicPostCount: number;
        distinctSourceCount: number;
        lastDetectedAt: Date;
      },
    ): Promise<void> {
      await withDatabaseErrors('Topic', () =>
        client.topic.update({
          where: { id },
          data: {
            ...data,
            classificationReasons: toJson(data.classificationReasons),
            trendBreakdown: toJson(data.trendBreakdown),
            arabicOpportunityBreakdown: toJson(data.arabicOpportunityBreakdown),
          },
          select: { id: true },
        }),
      );
    },

    async updateSummary(id: string, summary: string | null): Promise<void> {
      await withDatabaseErrors('Topic', () =>
        client.topic.update({ where: { id }, data: { summary }, select: { id: true } }),
      );
    },

    async setStatus(id: string, status: TopicStatus): Promise<Topic> {
      return withDatabaseErrors('Topic', async () => {
        const row = await client.topic.update({
          where: { id },
          data: { status },
          select: TOPIC_SELECT,
        });
        return toTopic(row);
      });
    },

    /**
     * Aggregates a topic's post statistics in one query.
     *
     * Everything the trend engine needs about a topic in a single round trip:
     * counts split by language, distinct sources, the newest post, and the two
     * adjacent velocity windows.
     */
    async loadTrendInputs(
      topicId: string,
      options: { now: Date; windowMinutes: number },
    ): Promise<{
      totalPostCount: number;
      commentCount: number;
      englishPostCount: number;
      arabicPostCount: number;
      distinctSourceCount: number;
      recentPostCount: number;
      previousPostCount: number;
      /** Publication time of the topic's oldest post; the age novelty decays from. */
      firstPostAt: Date | null;
      lastPostAt: Date | null;
      meanRelevance: number;
      meanEngagement: number;
      meanSourceAuthority: number;
    } | null> {
      const windowMs = options.windowMinutes * 60_000;
      const recentFrom = new Date(options.now.getTime() - windowMs);
      const previousFrom = new Date(options.now.getTime() - windowMs * 2);

      return withDatabaseErrors('Topic', async () => {
        const rows = await client.$queryRaw<
          {
            total_post_count: bigint;
            comment_count: bigint;
            english_post_count: bigint;
            arabic_post_count: bigint;
            distinct_source_count: bigint;
            recent_post_count: bigint;
            previous_post_count: bigint;
            first_post_at: Date | null;
            last_post_at: Date | null;
            mean_relevance: number | null;
            mean_engagement: number | null;
            mean_source_authority: number | null;
          }[]
        >`
          SELECT
            COUNT(*)                                                    AS total_post_count,
            COALESCE(SUM(c.comment_count), 0)                           AS comment_count,
            COUNT(*) FILTER (WHERE p."language" = 'EN')                 AS english_post_count,
            COUNT(*) FILTER (WHERE p."language" = 'AR')                 AS arabic_post_count,
            COUNT(DISTINCT p."source")                                  AS distinct_source_count,
            COUNT(*) FILTER (WHERE p."published_at" >= ${recentFrom})   AS recent_post_count,
            COUNT(*) FILTER (
              WHERE p."published_at" >= ${previousFrom}
                AND p."published_at" <  ${recentFrom}
            )                                                           AS previous_post_count,
            MIN(p."published_at")                                       AS first_post_at,
            MAX(p."published_at")                                       AS last_post_at,
            AVG(p."relevance_score")::float8                            AS mean_relevance,
            AVG(p."engagement_score")::float8                           AS mean_engagement,
            AVG(COALESCE(s."authority_weight", 0.5) * 100)::float8      AS mean_source_authority
          FROM "posts" p
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS comment_count FROM "comments" cm WHERE cm."post_id" = p."id"
          ) c ON TRUE
          -- Aggregated in the lateral rather than joined on. sources.kind is
          -- not unique - only slug is - so a plain join against it multiplies
          -- every post row by the number of sources configured for its kind,
          -- and a second RSS feed would silently double every count below.
          LEFT JOIN LATERAL (
            SELECT AVG(src."authority_weight") AS authority_weight
            FROM "sources" src WHERE src."kind" = p."source"
          ) s ON TRUE
          WHERE p."topic_id" = ${topicId}
        `;

        const row = rows[0];
        if (row === undefined || Number(row.total_post_count) === 0) return null;

        return {
          totalPostCount: Number(row.total_post_count),
          commentCount: Number(row.comment_count),
          englishPostCount: Number(row.english_post_count),
          arabicPostCount: Number(row.arabic_post_count),
          distinctSourceCount: Number(row.distinct_source_count),
          recentPostCount: Number(row.recent_post_count),
          previousPostCount: Number(row.previous_post_count),
          firstPostAt: row.first_post_at,
          lastPostAt: row.last_post_at,
          meanRelevance: row.mean_relevance ?? 0,
          meanEngagement: row.mean_engagement ?? 0,
          meanSourceAuthority: row.mean_source_authority ?? 50,
        };
      });
    },

    /**
     * Records a point-in-time trend snapshot.
     *
     * Upserted on `(topicId, recordedAt)` so a retried analysis job overwrites
     * its own snapshot rather than adding a second one at the same instant,
     * which would put a vertical step in every chart.
     */
    async recordSnapshot(input: {
      topicId: string;
      trendScore: number;
      postCount: number;
      engagement: number;
      velocity: number;
      relevance: number;
      freshness: number;
      crossSourceSignal: number;
      sourceAuthority: number;
      novelty: number;
      arabicOpportunity: number;
      saturationPenalty: number;
      recordedAt: Date;
    }): Promise<void> {
      const { topicId, recordedAt, ...values } = input;
      await withDatabaseErrors('TrendSnapshot', () =>
        client.trendSnapshot.upsert({
          where: { topicId_recordedAt: { topicId, recordedAt } },
          update: values,
          create: { topicId, recordedAt, ...values },
          select: { id: true },
        }),
      );
    },

    /**
     * Copies a topic's trend and opportunity scores onto its posts.
     *
     * A post inherits the headroom of the conversation it belongs to, and
     * denormalising it here is what lets the posts table be sorted and filtered
     * by trend without joining topics on every query.
     */
    async propagateScoresToPosts(
      topicId: string,
      scores: { trendScore: number; opportunityScore: number },
    ): Promise<number> {
      return withDatabaseErrors('Post', async () => {
        const result = await client.post.updateMany({
          where: { topicId },
          data: scores,
        });
        return result.count;
      });
    },

    async listActiveIds(limit = 1000): Promise<string[]> {
      return withDatabaseErrors('Topic', async () => {
        const rows = await client.topic.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true },
          orderBy: { lastDetectedAt: 'desc' },
          take: Math.max(1, Math.min(5000, limit)),
        });
        return rows.map((row) => row.id);
      });
    },

    async countCreatedInWindow(from: Date, to: Date): Promise<number> {
      return withDatabaseErrors('Topic', () =>
        client.topic.count({ where: { createdAt: { gte: from, lt: to } } }),
      );
    },

    async countByClassification(classification: TopicClassification): Promise<number> {
      return withDatabaseErrors('Topic', () =>
        client.topic.count({ where: { status: 'ACTIVE', classification } }),
      );
    },
  };
}

export type TopicRepository = ReturnType<typeof createTopicRepository>;
