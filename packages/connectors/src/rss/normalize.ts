import { stripHtml } from '@trendhunter/shared';
import type { CollectedItem, NormalizationResult } from '@trendhunter/types';

import {
  buildNormalizedPost,
  normalizeItems,
  rejectionFromIssues,
  toDate,
  type NormalizedItem,
} from '../normalize';

import { rssItemSchema } from './schema';

/**
 * Feed normalisation.
 *
 * Two decisions are worth stating. Descriptions go through `stripHtml` a second
 * time here even though the parser already applied it, because a payload may
 * have been stored by an older parser or hand-seeded, and markup reaching the
 * dashboard as text is the failure this guards against.
 *
 * An entry with no date falls back to the moment it was collected rather than
 * being rejected. Undated feeds are common, and the alternative — discarding a
 * publication's entire output — is far worse than treating a first sighting as
 * the publication time.
 */

export function normalizeRssItem(item: CollectedItem): NormalizedItem {
  const parsed = rssItemSchema.safeParse(item.payload);
  if (!parsed.success) return { rejected: rejectionFromIssues(parsed.error.issues) };

  const entry = parsed.data;
  const url = entry.link.trim();
  if (url === '') return { rejected: 'The feed entry has no link.' };

  const publishedAt = toDate(entry.publishedAt) ?? item.collectedAt;
  const body = entry.content ?? entry.summary ?? '';

  return {
    post: buildNormalizedPost({
      source: 'RSS',
      sourcePostId: item.sourceItemId,
      authorId: null,
      authorName: entry.author,
      authorUsername: null,
      title: entry.title,
      content: stripHtml(body),
      url,
      publishedAt,
      // A feed publishes; it does not measure reaction. Inventing engagement
      // numbers here would make RSS look permanently unpopular against sources
      // that really do report counts.
      likes: 0,
      replies: 0,
      reposts: 0,
      views: 0,
    }),
  };
}

export function normalizeRssItems(items: readonly CollectedItem[]): NormalizationResult {
  return normalizeItems(items, normalizeRssItem);
}
