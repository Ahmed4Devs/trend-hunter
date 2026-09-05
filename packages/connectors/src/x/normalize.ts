import type { CollectedItem, NormalizationResult } from '@trendhunter/types';

import {
  buildNormalizedPost,
  normalizeItems,
  rejectionFromIssues,
  toDate,
  type NormalizedItem,
} from '../normalize';

import { xPostSchema } from './schema';

/**
 * X normalisation.
 *
 * X has no title, so the whole post becomes content and the title stays null.
 * Impressions map to `views`, quotes are folded into `reposts` because both are
 * a redistribution of the post, and a post without a resolvable author is still
 * kept — the text is what the pipeline scores.
 */

export function normalizeXItem(item: CollectedItem): NormalizedItem {
  const parsed = xPostSchema.safeParse(item.payload);
  if (!parsed.success) {
    return { rejected: rejectionFromIssues(parsed.error.issues) };
  }

  const post = parsed.data;
  const publishedAt = toDate(post.created_at);
  if (!publishedAt) {
    return { rejected: 'The post has no usable created_at timestamp.' };
  }

  const username = post.author?.username;
  const metrics = post.public_metrics;

  return {
    post: buildNormalizedPost({
      source: 'X',
      sourcePostId: post.id,
      authorId: post.author?.id ?? post.author_id,
      authorName: post.author?.name,
      authorUsername: username,
      title: null,
      content: post.text,
      // Without a username the canonical `/i/web/status/` form still resolves.
      url:
        username === undefined
          ? `https://x.com/i/web/status/${post.id}`
          : `https://x.com/${username}/status/${post.id}`,
      publishedAt,
      likes: metrics?.like_count,
      replies: metrics?.reply_count,
      reposts: (metrics?.retweet_count ?? 0) + (metrics?.quote_count ?? 0),
      views: metrics?.impression_count,
    }),
  };
}

export function normalizeXItems(items: readonly CollectedItem[]): NormalizationResult {
  return normalizeItems(items, normalizeXItem);
}
