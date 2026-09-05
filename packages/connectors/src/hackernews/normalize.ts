import { stripHtml } from '@trendhunter/shared';
import type { CollectedItem, NormalizationResult } from '@trendhunter/types';

import {
  buildNormalizedPost,
  normalizeItems,
  rejectionFromIssues,
  toDate,
  type NormalizedItem,
} from '../normalize';

import { hackerNewsItemSchema } from './schema';

/**
 * Hacker News normalisation.
 *
 * The stored URL is the *submitted article* when there is one, not the
 * discussion page. That is deliberate: an article shared on Hacker News is very
 * often the same article that arrives through an RSS feed, and using the
 * article URL lets canonical-URL deduplication recognise the two as one story
 * across sources. Self-posts, which have no article, fall back to the item page.
 */

const ITEM_PAGE = 'https://news.ycombinator.com/item?id=';

export function normalizeHackerNewsItem(item: CollectedItem): NormalizedItem {
  const parsed = hackerNewsItemSchema.safeParse(item.payload);
  if (!parsed.success) return { rejected: rejectionFromIssues(parsed.error.issues) };

  const story = parsed.data;
  if (story.deleted === true || story.dead === true) {
    return { rejected: 'The story is deleted or flagged dead.' };
  }
  if (story.type !== undefined && story.type !== 'story') {
    return { rejected: `Unsupported Hacker News item type: ${story.type}` };
  }

  const publishedAt = toDate(story.time);
  if (!publishedAt) return { rejected: 'The story has no usable time.' };

  const id = String(story.id);
  const submittedUrl = story.url?.trim();

  return {
    post: buildNormalizedPost({
      source: 'HACKERNEWS',
      sourcePostId: id,
      authorId: null,
      authorName: story.by,
      authorUsername: story.by,
      title: story.title,
      // `text` is HTML on self-posts; the pipeline stores and renders text only.
      content: story.text === undefined ? '' : stripHtml(story.text),
      url: submittedUrl !== undefined && submittedUrl !== '' ? submittedUrl : `${ITEM_PAGE}${id}`,
      publishedAt,
      likes: story.score,
      replies: story.descendants,
      reposts: 0,
      views: 0,
    }),
  };
}

export function normalizeHackerNewsItems(items: readonly CollectedItem[]): NormalizationResult {
  return normalizeItems(items, normalizeHackerNewsItem);
}
