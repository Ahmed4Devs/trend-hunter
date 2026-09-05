import type { NormalizedComment, NormalizedPost, SourceKind } from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { Prisma } from '../client';
import { isUniqueConstraintViolation, withDatabaseErrors } from '../errors';

/**
 * The ingestion write path.
 *
 * Every write here is idempotent. Queue delivery is at-least-once, a collector
 * can be re-run against the same window, and a retried job re-processes the
 * same raw items — so "insert if new" is expressed as a unique constraint plus
 * `ON CONFLICT DO NOTHING`, never as a read followed by a write. The read-then-
 * write version looks correct in a test and duplicates rows under concurrency.
 */

export interface StoreRawItemsResult {
  /** Ids of the rows that exist after the call, new or pre-existing. */
  readonly rawItemIds: string[];
  readonly inserted: number;
  readonly duplicates: number;
}

export interface StorePostsResult {
  readonly postIds: string[];
  readonly inserted: number;
  readonly duplicates: number;
}

export function createIngestionRepository(client: PrismaClient) {
  return {
    /**
     * Stores collected items verbatim.
     *
     * `createMany({ skipDuplicates })` collapses the whole batch into one
     * statement; the follow-up select returns ids for both the rows we inserted
     * and the ones that were already there, so the caller can enqueue
     * normalisation for everything it collected regardless.
     */
    async storeRawItems(
      items: readonly {
        source: SourceKind;
        sourceItemId: string;
        // The provider's response, stored verbatim; cast at this boundary.
        payload: Readonly<Record<string, unknown>>;
        kind: 'POST' | 'COMMENT';
        parentSourceItemId?: string | null;
        contentHash: string;
        collectedAt: Date;
        scanRunId?: string | null;
      }[],
    ): Promise<StoreRawItemsResult> {
      if (items.length === 0) return { rawItemIds: [], inserted: 0, duplicates: 0 };

      return withDatabaseErrors('RawItem', async () => {
        const created = await client.rawItem.createMany({
          data: items.map((item) => ({
            source: item.source,
            sourceItemId: item.sourceItemId,
            payload: item.payload as Prisma.InputJsonValue,
            kind: item.kind,
            parentSourceItemId: item.parentSourceItemId ?? null,
            contentHash: item.contentHash,
            collectedAt: item.collectedAt,
            scanRunId: item.scanRunId ?? null,
          })),
          skipDuplicates: true,
        });

        const rows = await client.rawItem.findMany({
          where: {
            OR: items.map((item) => ({ source: item.source, sourceItemId: item.sourceItemId })),
          },
          select: { id: true },
        });

        return {
          rawItemIds: rows.map((row) => row.id),
          inserted: created.count,
          duplicates: items.length - created.count,
        };
      });
    },

    async findRawItems(
      ids: readonly string[],
    ): Promise<
      {
        id: string;
        source: SourceKind;
        sourceItemId: string;
        kind: 'POST' | 'COMMENT';
        parentSourceItemId: string | null;
        payload: Prisma.JsonValue;
        collectedAt: Date;
      }[]
    > {
      if (ids.length === 0) return [];
      return withDatabaseErrors('RawItem', () =>
        client.rawItem.findMany({
          where: { id: { in: [...ids] } },
          select: {
            id: true,
            source: true,
            sourceItemId: true,
            kind: true,
            parentSourceItemId: true,
            payload: true,
            collectedAt: true,
          },
        }),
      );
    },

    async markRawItemsProcessed(ids: readonly string[], processedAt: Date): Promise<void> {
      if (ids.length === 0) return;
      await withDatabaseErrors('RawItem', () =>
        client.rawItem.updateMany({ where: { id: { in: [...ids] } }, data: { processedAt } }),
      );
    },

    /**
     * Inserts normalised posts, skipping any the pipeline has already stored.
     *
     * Deduplication is layered: the `(source, sourcePostId)` unique constraint
     * catches the same item collected twice, and the content-hash lookup that
     * runs first catches the same story republished under a different id — the
     * cross-source case the trend engine would otherwise double-count.
     */
    async storePosts(
      posts: readonly (NormalizedPost & {
        language: 'EN' | 'AR' | 'OTHER';
        normalizedTitle?: string | null;
        normalizedContent?: string | null;
        engagementScore: number;
        rawItemId?: string | null;
      })[],
    ): Promise<StorePostsResult> {
      if (posts.length === 0) return { postIds: [], inserted: 0, duplicates: 0 };

      return withDatabaseErrors('Post', async () => {
        const hashes = posts.map((post) => post.contentHash);
        const existingByHash = await client.post.findMany({
          where: { contentHash: { in: hashes } },
          select: { id: true, contentHash: true },
        });
        const knownHashes = new Set(existingByHash.map((row) => row.contentHash));

        const fresh = posts.filter((post) => !knownHashes.has(post.contentHash));
        const now = new Date();

        const created =
          fresh.length === 0
            ? { count: 0 }
            : await client.post.createMany({
                data: fresh.map((post) => ({
                  source: post.source,
                  sourcePostId: post.sourcePostId,
                  authorId: post.authorId,
                  authorName: post.authorName,
                  authorUsername: post.authorUsername,
                  title: post.title,
                  content: post.content,
                  url: post.url,
                  canonicalUrl: post.canonicalUrl,
                  contentHash: post.contentHash,
                  language: post.language,
                  normalizedTitle: post.normalizedTitle ?? null,
                  normalizedContent: post.normalizedContent ?? null,
                  publishedAt: post.publishedAt,
                  collectedAt: now,
                  likes: post.likes,
                  replies: post.replies,
                  reposts: post.reposts,
                  views: post.views,
                  engagementScore: post.engagementScore,
                  rawItemId: post.rawItemId ?? null,
                })),
                skipDuplicates: true,
              });

        const rows = await client.post.findMany({
          where: { OR: posts.map((post) => ({ source: post.source, sourcePostId: post.sourcePostId })) },
          select: { id: true },
        });

        return {
          postIds: rows.map((row) => row.id),
          inserted: created.count,
          duplicates: posts.length - created.count,
        };
      });
    },

    /**
     * Inserts comments for posts that exist.
     *
     * A comment whose parent was skipped as a duplicate has nowhere to go, so
     * the parent ids are resolved first and orphans are dropped rather than
     * failing the whole batch on a foreign-key violation.
     */
    async storeComments(
      comments: readonly (NormalizedComment & {
        language: 'EN' | 'AR' | 'OTHER';
        normalizedContent?: string | null;
        rawItemId?: string | null;
      })[],
    ): Promise<{ commentIds: string[]; inserted: number; skipped: number }> {
      if (comments.length === 0) return { commentIds: [], inserted: 0, skipped: 0 };

      return withDatabaseErrors('Comment', async () => {
        const parents = await client.post.findMany({
          where: {
            OR: comments.map((comment) => ({
              source: comment.source,
              sourcePostId: comment.parentSourcePostId,
            })),
          },
          select: { id: true, source: true, sourcePostId: true },
        });
        const parentIdByKey = new Map(
          parents.map((parent) => [`${parent.source}:${parent.sourcePostId}`, parent.id]),
        );

        const attachable = comments.flatMap((comment) => {
          const postId = parentIdByKey.get(`${comment.source}:${comment.parentSourcePostId}`);
          return postId === undefined ? [] : [{ comment, postId }];
        });

        const created =
          attachable.length === 0
            ? { count: 0 }
            : await client.comment.createMany({
                data: attachable.map(({ comment, postId }) => ({
                  postId,
                  sourceCommentId: comment.sourceCommentId,
                  source: comment.source,
                  author: comment.author,
                  content: comment.content,
                  language: comment.language,
                  normalizedContent: comment.normalizedContent ?? null,
                  likes: comment.likes,
                  contentHash: comment.contentHash,
                  publishedAt: comment.publishedAt,
                  rawItemId: comment.rawItemId ?? null,
                })),
                skipDuplicates: true,
              });

        const rows =
          attachable.length === 0
            ? []
            : await client.comment.findMany({
                where: {
                  OR: attachable.map(({ comment }) => ({
                    source: comment.source,
                    sourceCommentId: comment.sourceCommentId,
                  })),
                },
                select: { id: true },
              });

        return {
          commentIds: rows.map((row) => row.id),
          inserted: created.count,
          skipped: comments.length - attachable.length,
        };
      });
    },

    /** Assigns a post to a topic and records why, in one transaction. */
    async assignPostToTopic(input: {
      postId: string;
      topicId: string;
      similarity: number;
      publishedAt: Date;
    }): Promise<void> {
      await withDatabaseErrors('Topic', () =>
        client.$transaction(async (tx) => {
          await tx.post.update({
            where: { id: input.postId },
            data: { topicId: input.topicId },
            select: { id: true },
          });
          await tx.topicPost.upsert({
            where: { topicId_postId: { topicId: input.topicId, postId: input.postId } },
            update: { similarity: input.similarity },
            create: {
              topicId: input.topicId,
              postId: input.postId,
              similarity: input.similarity,
            },
          });
          // The topic's activity window has to move with its newest post, or a
          // freshly-joined post would not lift the topic's freshness score.
          await tx.topic.update({
            where: { id: input.topicId },
            data: { lastDetectedAt: input.publishedAt },
            select: { id: true },
          });
        }),
      );
    },

    /** Posts that have an embedding but no topic yet. */
    async findUnclusteredPostIds(limit: number): Promise<string[]> {
      return withDatabaseErrors('Post', async () => {
        const rows = await client.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "posts"
          WHERE "topic_id" IS NULL
            AND "embedding" IS NOT NULL
            AND "is_hidden" = false
          ORDER BY "published_at" DESC
          LIMIT ${Math.max(1, Math.min(1000, limit))}
        `;
        return rows.map((row) => row.id);
      });
    },

    /** Loads the fields the clustering engine compares, plus the embedding. */
    async loadPostsForClustering(
      ids: readonly string[],
    ): Promise<
      {
        id: string;
        title: string | null;
        content: string;
        source: SourceKind;
        publishedAt: Date;
        embedding: number[];
      }[]
    > {
      if (ids.length === 0) return [];
      return withDatabaseErrors('Post', async () => {
        const rows = await client.$queryRaw<
          {
            id: string;
            title: string | null;
            content: string;
            source: SourceKind;
            published_at: Date;
            embedding: string;
          }[]
        >`
          SELECT "id", "title", "content", "source", "published_at",
                 "embedding"::text AS "embedding"
          FROM "posts"
          WHERE "id" IN (${Prisma.join([...ids])})
            AND "embedding" IS NOT NULL
        `;
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          source: row.source,
          publishedAt: row.published_at,
          embedding: JSON.parse(row.embedding) as number[],
        }));
      });
    },

    /** Text of the records that still need an embedding. */
    async loadTextsForEmbedding(
      kind: 'post' | 'comment',
      ids: readonly string[],
    ): Promise<{ id: string; text: string }[]> {
      if (ids.length === 0) return [];
      return withDatabaseErrors(kind === 'post' ? 'Post' : 'Comment', async () => {
        if (kind === 'post') {
          const rows = await client.post.findMany({
            where: { id: { in: [...ids] } },
            select: { id: true, title: true, content: true },
          });
          return rows.map((row) => ({
            id: row.id,
            text: row.title === null ? row.content : `${row.title}\n\n${row.content}`,
          }));
        }
        const rows = await client.comment.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, content: true },
        });
        return rows.map((row) => ({ id: row.id, text: row.content }));
      });
    },

    /** Deletes raw payloads past the retention window. */
    async pruneRawItems(olderThan: Date): Promise<number> {
      return withDatabaseErrors('RawItem', async () => {
        const result = await client.rawItem.deleteMany({
          where: { collectedAt: { lt: olderThan }, processedAt: { not: null } },
        });
        return result.count;
      });
    },

    isDuplicate: isUniqueConstraintViolation,
  };
}

export type IngestionRepository = ReturnType<typeof createIngestionRepository>;
