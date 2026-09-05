import { normalizeItemsForSource } from '@trendhunter/connectors';
import { calculateEngagementScore } from '@trendhunter/ranking';
import { buildNormalizedSearchFields } from '@trendhunter/search';
import { detectLanguage, MAX_IDS_PER_JOB } from '@trendhunter/shared';
import {
  QUEUE_NAMES,
  type CollectedItem,
  type NormalizeJobPayload,
} from '@trendhunter/types';

import type { JobContext } from '../runtime/processor';
import { enqueue } from '../runtime/queues';
import { chunked } from './collect';

/**
 * Step 2: normalisation, language detection and deduplication.
 *
 * Raw provider payloads become the platform's common internal format here.
 * Three things happen that the rest of the pipeline depends on:
 *
 *  * **Language detection**, because the Arabic opportunity score is derived
 *    from the English/Arabic split and the full-text index picks its stemmer
 *    from this column;
 *  * **Arabic normalisation**, producing the folded copies the Arabic tsvector
 *    reads. The identical folding is applied to a query at search time, and
 *    applying it to one side only would be worse than applying it to neither;
 *  * **Engagement scoring**, which flattens provider-specific counters onto one
 *    comparable 0..100 scale — 300 Hacker News points and 300 X likes are not
 *    the same amount of attention.
 *
 * Deduplication is layered and lives in the repository: a unique constraint on
 * `(source, source_item_id)` catches re-collection, and a content-hash lookup
 * catches the same story republished under a different id.
 */
export async function processNormalizeJob(
  context: JobContext<NormalizeJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories } = container;

  const rawItems = await repositories.ingestion.findRawItems(payload.rawItemIds);
  if (rawItems.length === 0) {
    logger.info('no raw items remain to normalise');
    return;
  }

  // Rebuilt exactly as the connector produced it, kind and parent included:
  // the whole point of storing raw items is that they can be reprocessed
  // faithfully when the normalisation rules change.
  const collected: CollectedItem[] = rawItems.map((row) => ({
    source: row.source,
    sourceItemId: row.sourceItemId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    kind: row.kind === 'COMMENT' ? 'comment' : 'post',
    ...(row.parentSourceItemId === null
      ? {}
      : { parentSourceItemId: row.parentSourceItemId }),
    collectedAt: row.collectedAt,
  }));

  const normalized = normalizeItemsForSource(payload.source, collected);

  for (const rejection of normalized.rejected) {
    // A rejected item is a fact about the provider, not a failure of this job:
    // it is recorded and the rest of the batch proceeds.
    logger.warn(
      { sourceItemId: rejection.sourceItemId, reason: rejection.reason },
      'item rejected during normalisation',
    );
  }

  const rawItemIdBySourceId = new Map(rawItems.map((row) => [row.sourceItemId, row.id]));

  const posts = normalized.posts.map((post) => {
    const detected = detectLanguage(`${post.title ?? ''} ${post.content}`);
    const searchFields = buildNormalizedSearchFields(detected.language, {
      title: post.title,
      content: post.content,
    });
    return {
      ...post,
      language: detected.language,
      normalizedTitle: searchFields.normalizedTitle,
      normalizedContent: searchFields.normalizedContent,
      engagementScore: calculateEngagementScore({
        likes: post.likes,
        replies: post.replies,
        reposts: post.reposts,
        views: post.views,
      }),
      rawItemId: rawItemIdBySourceId.get(post.sourcePostId) ?? null,
    };
  });

  const comments = normalized.comments.map((comment) => {
    const detected = detectLanguage(comment.content);
    const searchFields = buildNormalizedSearchFields(detected.language, {
      content: comment.content,
    });
    return {
      ...comment,
      language: detected.language,
      normalizedContent: searchFields.normalizedContent,
      rawItemId: rawItemIdBySourceId.get(comment.sourceCommentId) ?? null,
    };
  });

  const storedPosts = await repositories.ingestion.storePosts(posts);
  const storedComments = await repositories.ingestion.storeComments(comments);

  await repositories.ingestion.markRawItemsProcessed(payload.rawItemIds, new Date());
  await repositories.operations.incrementScanCounters(payload.scanRunId, {
    postsCreated: storedPosts.inserted,
    commentsCreated: storedComments.inserted,
    duplicatesSkipped: storedPosts.duplicates,
  });

  logger.info(
    {
      source: payload.source,
      posts: storedPosts.inserted,
      comments: storedComments.inserted,
      duplicates: storedPosts.duplicates,
      rejected: normalized.rejected.length,
    },
    'normalisation finished',
  );

  // Everything that was stored needs an embedding, including rows a previous
  // attempt inserted: the ids come back from the repository either way, so a
  // retry re-enqueues rather than silently leaving rows unembedded.
  const postIds = storedPosts.postIds;
  const commentIds = storedComments.commentIds;
  if (postIds.length === 0 && commentIds.length === 0) return;

  for (const chunk of chunked(postIds, MAX_IDS_PER_JOB)) {
    await enqueue(container, QUEUE_NAMES.embeddings, 'embed', {
      scanRunId: payload.scanRunId,
      postIds: chunk,
      commentIds: [],
    });
  }
  for (const chunk of chunked(commentIds, MAX_IDS_PER_JOB)) {
    await enqueue(container, QUEUE_NAMES.embeddings, 'embed', {
      scanRunId: payload.scanRunId,
      postIds: [],
      commentIds: chunk,
    });
  }
}
