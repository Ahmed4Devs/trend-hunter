import type { CollectedItem, NormalizationResult } from '@trendhunter/types';

import {
  buildNormalizedComment,
  buildNormalizedPost,
  normalizeItems,
  rejectionFromIssues,
  toDate,
  type NormalizedItem,
} from '../normalize';

import {
  commentFullname,
  redditCommentSchema,
  redditSubmissionSchema,
  submissionFullname,
} from './schema';

/**
 * Reddit normalisation.
 *
 * The URL is always the permalink rather than the outbound link of a link post:
 * the discussion is the artefact this platform cares about, and two submissions
 * pointing at the same article are two separate conversations.
 *
 * Reddit exposes no view count and no repost count, so both stay zero rather
 * than being invented from the score — a fabricated metric would flow straight
 * into engagement scoring and be indistinguishable from a real one.
 */

const REDDIT_ORIGIN = 'https://www.reddit.com';

export function normalizeRedditItem(item: CollectedItem): NormalizedItem {
  return item.kind === 'comment' ? normalizeComment(item) : normalizeSubmission(item);
}

function normalizeSubmission(item: CollectedItem): NormalizedItem {
  const parsed = redditSubmissionSchema.safeParse(item.payload);
  if (!parsed.success) return { rejected: rejectionFromIssues(parsed.error.issues) };

  const submission = parsed.data;
  const publishedAt = toDate(submission.created_utc);
  if (!publishedAt) return { rejected: 'The submission has no usable created_utc timestamp.' };

  const url = resolveSubmissionUrl(submission.permalink, submission.url, submission.id);
  if (url === null) return { rejected: 'The submission has no permalink and no URL.' };

  return {
    post: buildNormalizedPost({
      source: 'REDDIT',
      sourcePostId: submissionFullname(submission),
      authorId: null,
      authorName: submission.author,
      authorUsername: submission.author,
      title: submission.title,
      content: submission.selftext ?? '',
      url,
      publishedAt,
      likes: submission.score ?? submission.ups,
      replies: submission.num_comments,
      reposts: 0,
      views: 0,
    }),
  };
}

function normalizeComment(item: CollectedItem): NormalizedItem {
  const parsed = redditCommentSchema.safeParse(item.payload);
  if (!parsed.success) return { rejected: rejectionFromIssues(parsed.error.issues) };

  const comment = parsed.data;
  const publishedAt = toDate(comment.created_utc);
  if (!publishedAt) return { rejected: 'The comment has no usable created_utc timestamp.' };

  // Reddit uses these two markers for removed content. They carry no signal and
  // would otherwise be clustered together as a strongly recurring "topic".
  const body = comment.body.trim();
  if (body === '[deleted]' || body === '[removed]') {
    return { rejected: 'The comment was deleted or removed.' };
  }

  return {
    comment: buildNormalizedComment({
      source: 'REDDIT',
      sourceCommentId: commentFullname(comment),
      parentSourcePostId: item.parentSourceItemId ?? comment.link_id,
      author: comment.author,
      content: comment.body,
      likes: comment.score,
      publishedAt,
    }),
  };
}

/**
 * Prefers the permalink, falls back to the submission's outbound URL, and
 * finally reconstructs a canonical comments URL from the id.
 */
function resolveSubmissionUrl(
  permalink: string | undefined,
  url: string | undefined,
  id: string,
): string | null {
  if (permalink !== undefined && permalink.trim() !== '') {
    return permalink.startsWith('http') ? permalink : `${REDDIT_ORIGIN}${permalink}`;
  }
  if (url?.trim().startsWith('http') === true) return url.trim();
  return id.trim() === '' ? null : `${REDDIT_ORIGIN}/comments/${id}`;
}

export function normalizeRedditItems(items: readonly CollectedItem[]): NormalizationResult {
  return normalizeItems(items, normalizeRedditItem);
}
