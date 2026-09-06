import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '@trendhunter/shared';
import type {
  Comment,
  ContentLanguage,
  Paginated,
  PaginationParams,
  Post,
  PostDetail,
  SortDirection,
  SourceKind,
} from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { type Prisma } from '../client';
import { withDatabaseErrors } from '../errors';
import {
  COMMENT_SELECT,
  POST_SELECT,
  TRANSLATION_SELECT,
  toComment,
  toPost,
  toPostRelevanceBreakdown,
  toTranslation,
} from '../mappers';
import { loadSavedPostIds } from './saved-flags';

/**
 * Post reads and writes.
 *
 * Every list query here is bounded and every filter is applied in SQL. The one
 * rule that matters for correctness at scale: the pipeline never loads a post
 * to decide whether it already has one — deduplication is a unique constraint
 * and an `ON CONFLICT`, not a read-then-write race.
 */

/**
 * Nearest neighbours of a post by embedding proximity.
 *
 * Declared outside the factory so both `findRelated` and `findDetailById` share
 * one implementation.
 *
 * The source embedding is read first and then bound as a parameter, rather than
 * joining `posts` to itself and ordering by `source.embedding <=> other.embedding`.
 * The self-join reads as the tidier query and cost a sequential scan on every
 * call: pgvector can only use an HNSW index when one side of the distance
 * operator is a constant, so with a column on both sides PostgreSQL computed
 * the distance to every row and sorted the lot. `EXPLAIN` showed a Seq Scan and
 * a full Sort where the plan below shows an Index Scan. Nothing errors when
 * that happens, which is exactly why it survived — it is only slow, and only
 * once the table is large.
 */
async function findRelatedPosts(
  client: PrismaClient,
  id: string,
  limit: number,
  userId: string | null,
): Promise<Post[]> {
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit)));

  const [source] = await client.$queryRaw<{ embedding: string | null }[]>`
    SELECT "embedding"::text AS "embedding" FROM "posts" WHERE "id" = ${id} LIMIT 1
  `;
  // No embedding means the post has not been through the embeddings worker yet;
  // it has no neighbours to offer rather than an empty result to explain.
  if (source?.embedding === null || source?.embedding === undefined) return [];
  const literal = source.embedding;

  // `is_hidden` is applied after the index scan, so ask the index for more
  // candidates than the page needs; `strict_order` keeps it scanning until the
  // limit is met without disturbing distance ordering.
  const efSearch = Math.min(1000, Math.max(bounded, bounded * 8));

  const rows = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(efSearch)}, true)`;
    await tx.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`;
    return tx.$queryRaw<{ related_id: string }[]>`
      SELECT p."id" AS "related_id"
      FROM "posts" p
      WHERE p."embedding" IS NOT NULL
        AND p."is_hidden" = false
        AND p."id" <> ${id}
      ORDER BY p."embedding" <=> ${literal}::vector
      LIMIT ${bounded}
    `;
  });
  if (rows.length === 0) return [];

  const related = await client.post.findMany({
    where: { id: { in: rows.map((row) => row.related_id) } },
    select: POST_SELECT,
  });
  const byId = new Map(related.map((row) => [row.id, row]));
  const saved = await loadSavedPostIds(
    client,
    related.map((row) => row.id),
    userId,
  );
  return rows
    .map((row) => byId.get(row.related_id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => toPost(row, { isSaved: saved.has(row.id) }));
}

export interface PostListFilters {
  readonly sources?: readonly SourceKind[];
  readonly languages?: readonly ContentLanguage[];
  readonly topicId?: string;
  readonly publishedFrom?: Date;
  readonly publishedTo?: Date;
  readonly minRelevance?: number;
  readonly minTrend?: number;
  readonly minOpportunity?: number;
  /**
   * Restricts to posts the calling user has, or has not, saved. Ignored when
   * the reader is given no user id: "saved by nobody in particular" is not a
   * question the table can answer.
   */
  readonly isSaved?: boolean;
  readonly isRead?: boolean;
  readonly includeHidden?: boolean;
  /** Restricts to these ids, preserving their order. Used by search. */
  readonly ids?: readonly string[];
}

export type PostSortField =
  | 'publishedAt'
  | 'collectedAt'
  | 'relevanceScore'
  | 'trendScore'
  | 'opportunityScore'
  | 'engagementScore';

export interface PostListOptions {
  readonly filters?: PostListFilters;
  readonly pagination?: Partial<PaginationParams>;
  readonly sortBy?: PostSortField;
  readonly sortDirection?: SortDirection;
}

function buildWhere(
  filters: PostListFilters = {},
  userId: string | null = null,
): Prisma.PostWhereInput {
  const where: Prisma.PostWhereInput = {};

  if (filters.includeHidden !== true) where.isHidden = false;
  if (filters.sources && filters.sources.length > 0) where.source = { in: [...filters.sources] };
  if (filters.languages && filters.languages.length > 0) {
    where.language = { in: [...filters.languages] };
  }
  if (filters.topicId !== undefined) where.topicId = filters.topicId;
  // Answered from `saved_items`, which is the only place that knows *whose*
  // save it is. A boolean column on `posts` would filter one user's page by
  // every other user's saves.
  if (filters.isSaved !== undefined && userId !== null) {
    where.savedItems = filters.isSaved ? { some: { userId } } : { none: { userId } };
  }
  if (filters.isRead !== undefined) where.isRead = filters.isRead;
  if (filters.ids !== undefined) where.id = { in: [...filters.ids] };

  if (filters.publishedFrom !== undefined || filters.publishedTo !== undefined) {
    where.publishedAt = {
      ...(filters.publishedFrom !== undefined ? { gte: filters.publishedFrom } : {}),
      ...(filters.publishedTo !== undefined ? { lte: filters.publishedTo } : {}),
    };
  }
  if (filters.minRelevance !== undefined) where.relevanceScore = { gte: filters.minRelevance };
  if (filters.minTrend !== undefined) where.trendScore = { gte: filters.minTrend };
  if (filters.minOpportunity !== undefined)
    where.opportunityScore = { gte: filters.minOpportunity };

  return where;
}

export function createPostRepository(client: PrismaClient) {
  return {
    async list(
      options: PostListOptions = {},
      userId: string | null = null,
    ): Promise<Paginated<Post>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = buildWhere(options.filters, userId);
      const sortBy = options.sortBy ?? 'publishedAt';
      const direction = options.sortDirection ?? 'desc';

      return withDatabaseErrors('Post', async () => {
        // One round trip for both: a separate count would double the latency of
        // every table page for no benefit.
        const [rows, totalItems] = await client.$transaction([
          client.post.findMany({
            where,
            select: POST_SELECT,
            // Secondary key on id keeps paging stable when the primary key ties,
            // which it frequently does on integer scores.
            orderBy: [{ [sortBy]: direction }, { id: 'asc' }],
            skip,
            take,
          }),
          client.post.count({ where }),
        ]);

        const saved = await loadSavedPostIds(
          client,
          rows.map((row) => row.id),
          userId,
        );

        return {
          items: rows.map((row) => toPost(row, { isSaved: saved.has(row.id) })),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    /** Comments, optionally scoped to one post. */
    async listComments(
      options: {
        postId?: string;
        languages?: readonly ContentLanguage[];
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<Comment>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where: Prisma.CommentWhereInput = {
        ...(options.postId === undefined ? {} : { postId: options.postId }),
        ...(options.languages && options.languages.length > 0
          ? { language: { in: [...options.languages] } }
          : {}),
      };

      return withDatabaseErrors('Comment', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.comment.findMany({
            where,
            select: COMMENT_SELECT,
            orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.comment.count({ where }),
        ]);
        return {
          items: rows.map(toComment),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async countCommentsInWindow(from: Date, to: Date): Promise<number> {
      return withDatabaseErrors('Comment', () =>
        client.comment.count({ where: { createdAt: { gte: from, lt: to } } }),
      );
    },

    async findById(id: string, userId: string | null = null): Promise<Post | null> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.findUnique({ where: { id }, select: POST_SELECT });
        if (row === null) return null;
        const saved = await loadSavedPostIds(client, [row.id], userId);
        return toPost(row, { isSaved: saved.has(row.id) });
      });
    },

    /**
     * Loads a post with everything the detail page needs.
     *
     * Related posts come from the vector index rather than from the topic, so
     * the panel is still useful for a post that has not been clustered yet.
     */
    async findDetailById(id: string, userId: string): Promise<PostDetail | null> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.findUnique({ where: { id }, select: POST_SELECT });
        if (row === null) return null;

        const [comments, translations, rawItem, relatedPosts] = await Promise.all([
          client.comment.findMany({
            where: { postId: id },
            select: COMMENT_SELECT,
            orderBy: [{ likes: 'desc' }, { publishedAt: 'asc' }],
            take: 50,
          }),
          client.translation.findMany({
            where: { postId: id, userId },
            select: TRANSLATION_SELECT,
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
          client.post.findUnique({
            where: { id },
            select: { rawItem: { select: { payload: true } } },
          }),
          findRelatedPosts(client, id, 6, userId),
        ]);

        const payload = rawItem?.rawItem?.payload ?? null;
        const saved = await loadSavedPostIds(client, [row.id], userId);

        return {
          ...toPost(row, { isSaved: saved.has(row.id) }),
          relevanceBreakdown: toPostRelevanceBreakdown(row),
          rawMetadata:
            typeof payload === 'object' && payload !== null && !Array.isArray(payload)
              ? payload
              : null,
          comments: comments.map(toComment),
          relatedPosts,
          translations: translations.map(toTranslation),
        };
      });
    },

    /** Related posts by embedding proximity, excluding the post itself. */
    async findRelated(id: string, limit = 6, userId: string | null = null): Promise<Post[]> {
      return withDatabaseErrors('Post', () => findRelatedPosts(client, id, limit, userId));
    },

    /** Preserves the ranking order supplied by the search layer. */
    async findManyInOrder(ids: readonly string[], userId: string | null = null): Promise<Post[]> {
      if (ids.length === 0) return [];
      return withDatabaseErrors('Post', async () => {
        const rows = await client.post.findMany({
          where: { id: { in: [...ids] } },
          select: POST_SELECT,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const saved = await loadSavedPostIds(
          client,
          rows.map((row) => row.id),
          userId,
        );
        return ids
          .map((id) => byId.get(id))
          .filter((row): row is NonNullable<typeof row> => row !== undefined)
          .map((row) => toPost(row, { isSaved: saved.has(row.id) }));
      });
    },

    async markRead(id: string, isRead: boolean, userId: string | null = null): Promise<Post> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.update({
          where: { id },
          data: { isRead },
          select: POST_SELECT,
        });
        const saved = await loadSavedPostIds(client, [row.id], userId);
        return toPost(row, { isSaved: saved.has(row.id) });
      });
    },

    async setHidden(id: string, isHidden: boolean, userId: string | null = null): Promise<Post> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.update({
          where: { id },
          data: { isHidden },
          select: POST_SELECT,
        });
        const saved = await loadSavedPostIds(client, [row.id], userId);
        return toPost(row, { isSaved: saved.has(row.id) });
      });
    },

    async updateScores(
      id: string,
      scores: {
        relevanceScore?: number;
        trendScore?: number;
        opportunityScore?: number;
        engagementScore?: number;
        relevanceBreakdown?: Prisma.InputJsonValue;
      },
    ): Promise<void> {
      await withDatabaseErrors('Post', () =>
        client.post.update({ where: { id }, data: scores, select: { id: true } }),
      );
    },

    async countBySource(since?: Date): Promise<{ source: SourceKind; count: number }[]> {
      return withDatabaseErrors('Post', async () => {
        const grouped = await client.post.groupBy({
          by: ['source'],
          where: {
            isHidden: false,
            ...(since === undefined ? {} : { collectedAt: { gte: since } }),
          },
          _count: { _all: true },
        });
        return grouped.map((entry) => ({ source: entry.source, count: entry._count._all }));
      });
    },

    async countInWindow(from: Date, to: Date): Promise<number> {
      return withDatabaseErrors('Post', () =>
        client.post.count({ where: { collectedAt: { gte: from, lt: to }, isHidden: false } }),
      );
    },

    /** Posts above a relevance threshold, which the dashboard calls "relevant ideas". */
    async countRelevantInWindow(from: Date, to: Date, minRelevance: number): Promise<number> {
      return withDatabaseErrors('Post', () =>
        client.post.count({
          where: {
            collectedAt: { gte: from, lt: to },
            isHidden: false,
            relevanceScore: { gte: minRelevance },
          },
        }),
      );
    },
  };
}

export type PostRepository = ReturnType<typeof createPostRepository>;
