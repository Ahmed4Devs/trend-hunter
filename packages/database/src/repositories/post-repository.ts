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
 * one implementation. The join is done in SQL rather than by fetching the
 * source embedding first: that keeps a 768-float vector out of the Node process
 * entirely and lets PostgreSQL use the HNSW index directly.
 */
async function findRelatedPosts(client: PrismaClient, id: string, limit: number): Promise<Post[]> {
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit)));
  const rows = await client.$queryRaw<{ related_id: string }[]>`
    SELECT other."id" AS "related_id"
    FROM "posts" source
    JOIN "posts" other
      ON other."id" <> source."id"
     AND other."embedding" IS NOT NULL
     AND other."is_hidden" = false
    WHERE source."id" = ${id}
      AND source."embedding" IS NOT NULL
    ORDER BY source."embedding" <=> other."embedding"
    LIMIT ${bounded}
  `;
  if (rows.length === 0) return [];

  const related = await client.post.findMany({
    where: { id: { in: rows.map((row) => row.related_id) } },
    select: POST_SELECT,
  });
  const byId = new Map(related.map((row) => [row.id, row]));
  return rows
    .map((row) => byId.get(row.related_id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map(toPost);
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

function buildWhere(filters: PostListFilters = {}): Prisma.PostWhereInput {
  const where: Prisma.PostWhereInput = {};

  if (filters.includeHidden !== true) where.isHidden = false;
  if (filters.sources && filters.sources.length > 0) where.source = { in: [...filters.sources] };
  if (filters.languages && filters.languages.length > 0) {
    where.language = { in: [...filters.languages] };
  }
  if (filters.topicId !== undefined) where.topicId = filters.topicId;
  if (filters.isSaved !== undefined) where.isSaved = filters.isSaved;
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
    async list(options: PostListOptions = {}): Promise<Paginated<Post>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = buildWhere(options.filters);
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

        return {
          items: rows.map(toPost),
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

    async findById(id: string): Promise<Post | null> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.findUnique({ where: { id }, select: POST_SELECT });
        return row === null ? null : toPost(row);
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
          findRelatedPosts(client, id, 6),
        ]);

        const payload = rawItem?.rawItem?.payload ?? null;

        return {
          ...toPost(row),
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
    async findRelated(id: string, limit = 6): Promise<Post[]> {
      return withDatabaseErrors('Post', () => findRelatedPosts(client, id, limit));
    },

    /** Preserves the ranking order supplied by the search layer. */
    async findManyInOrder(ids: readonly string[]): Promise<Post[]> {
      if (ids.length === 0) return [];
      return withDatabaseErrors('Post', async () => {
        const rows = await client.post.findMany({
          where: { id: { in: [...ids] } },
          select: POST_SELECT,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        return ids
          .map((id) => byId.get(id))
          .filter((row): row is NonNullable<typeof row> => row !== undefined)
          .map(toPost);
      });
    },

    async markRead(id: string, isRead: boolean): Promise<Post> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.update({
          where: { id },
          data: { isRead },
          select: POST_SELECT,
        });
        return toPost(row);
      });
    },

    async setHidden(id: string, isHidden: boolean): Promise<Post> {
      return withDatabaseErrors('Post', async () => {
        const row = await client.post.update({
          where: { id },
          data: { isHidden },
          select: POST_SELECT,
        });
        return toPost(row);
      });
    },

    /** Keeps the denormalised `is_saved` flag in step with the saved_items table. */
    async setSaved(id: string, isSaved: boolean): Promise<void> {
      await withDatabaseErrors('Post', () =>
        client.post.update({ where: { id }, data: { isSaved }, select: { id: true } }),
      );
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
