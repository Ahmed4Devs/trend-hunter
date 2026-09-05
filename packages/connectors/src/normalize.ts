import {
  canonicalizeUrl,
  contentHash,
  MAX_CONTENT_LENGTH,
  sanitizeText,
  ValidationError,
} from '@trendhunter/shared';
import type {
  CollectedItem,
  NormalizationResult,
  NormalizedComment,
  NormalizedPost,
  SourceKind,
} from '@trendhunter/types';

/**
 * Normalisation helpers shared by all five connectors.
 *
 * The rules applied here are the ones the rest of the platform depends on and
 * must therefore never be left to a provider adapter's discretion: every text
 * field is sanitised, every counter is a non-negative integer, every post
 * carries a canonical URL and a content hash computed the same way, and a
 * payload that does not make sense is *rejected* rather than stored half-formed
 * or allowed to throw out of the ingestion loop.
 */

/** Titles are indexed and rendered in lists; a novel in one is never useful. */
export const MAX_TITLE_LENGTH = 500;

/** Author display fields, bounded for the same reason. */
export const MAX_AUTHOR_LENGTH = 200;

/**
 * Counters below this are treated as real. Above it a provider is either
 * reporting in a different unit or the payload is hostile, and an absurd
 * engagement number would dominate every ranking it touched.
 */
export const MAX_COUNTER = 1_000_000_000;

/** Timestamps before this are treated as missing rather than as the epoch. */
const EARLIEST_TIMESTAMP_MS = Date.UTC(1995, 0, 1);

/** Seconds-versus-milliseconds boundary: any epoch below this is in seconds. */
const EPOCH_SECONDS_CEILING = 100_000_000_000;

/**
 * Coerces a provider counter to a non-negative integer.
 *
 * Providers send these as numbers, as decimal strings, as `null`, and
 * occasionally as objects; none of those may become a `NaN` in a score.
 */
export function toCount(value: unknown): number {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(MAX_COUNTER, Math.floor(numeric));
}

/**
 * Parses a provider timestamp, returning `null` when it cannot be trusted.
 *
 * Handles ISO strings, epoch seconds and epoch milliseconds, because the five
 * providers between them use all three.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : accept(value);

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < EPOCH_SECONDS_CEILING ? value * 1000 : value;
    return accept(new Date(ms));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return toDate(Number(trimmed));
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : accept(parsed);
  }

  return null;
}

function accept(date: Date): Date | null {
  return date.getTime() < EARLIEST_TIMESTAMP_MS ? null : date;
}

/** Sanitises an optional text field, collapsing an empty result to `null`. */
export function toOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = sanitizeText(value, maxLength);
  return clean.length === 0 ? null : clean;
}

export interface PostDraft {
  readonly source: SourceKind;
  readonly sourcePostId: string;
  readonly authorId?: unknown;
  readonly authorName?: unknown;
  readonly authorUsername?: unknown;
  readonly title?: unknown;
  readonly content: string;
  readonly url: string;
  readonly publishedAt: Date;
  readonly likes?: unknown;
  readonly replies?: unknown;
  readonly reposts?: unknown;
  readonly views?: unknown;
}

/**
 * Builds a normalised post.
 *
 * Throws {@link ValidationError} when the item carries no usable text or no
 * URL; {@link normalizeItems} turns that into a rejection so one bad item can
 * never abort a collection.
 */
export function buildNormalizedPost(draft: PostDraft): NormalizedPost {
  const title = toOptionalText(draft.title, MAX_TITLE_LENGTH);
  const content = sanitizeText(draft.content, MAX_CONTENT_LENGTH);
  if (title === null && content.length === 0) {
    throw new ValidationError('The item has neither a title nor any content.');
  }

  const url = draft.url.trim();
  if (url === '') {
    throw new ValidationError('The item has no URL.');
  }

  return {
    source: draft.source,
    sourcePostId: draft.sourcePostId,
    authorId: toOptionalText(draft.authorId, MAX_AUTHOR_LENGTH),
    authorName: toOptionalText(draft.authorName, MAX_AUTHOR_LENGTH),
    authorUsername: toOptionalText(draft.authorUsername, MAX_AUTHOR_LENGTH),
    title,
    content,
    url,
    publishedAt: draft.publishedAt,
    likes: toCount(draft.likes),
    replies: toCount(draft.replies),
    reposts: toCount(draft.reposts),
    views: toCount(draft.views),
    // Hashed over the text alone: the same story published under two URLs is a
    // duplicate, and the same URL with two different bodies is not.
    contentHash: contentHash(title ?? '', content),
    canonicalUrl: canonicalizeUrl(url),
  };
}

export interface CommentDraft {
  readonly source: SourceKind;
  readonly sourceCommentId: string;
  readonly parentSourcePostId: string;
  readonly author?: unknown;
  readonly content: string;
  readonly likes?: unknown;
  readonly publishedAt: Date;
}

export function buildNormalizedComment(draft: CommentDraft): NormalizedComment {
  const content = sanitizeText(draft.content, MAX_CONTENT_LENGTH);
  if (content.length === 0) {
    throw new ValidationError('The comment has no content.');
  }
  if (draft.parentSourcePostId.trim() === '') {
    throw new ValidationError('The comment has no parent post.');
  }

  return {
    source: draft.source,
    sourceCommentId: draft.sourceCommentId,
    parentSourcePostId: draft.parentSourcePostId,
    author: toOptionalText(draft.author, MAX_AUTHOR_LENGTH),
    content,
    likes: toCount(draft.likes),
    publishedAt: draft.publishedAt,
    contentHash: contentHash(content),
  };
}

/** What a per-provider normaliser returns for a single collected item. */
export type NormalizedItem =
  | { readonly post: NormalizedPost }
  | { readonly comment: NormalizedComment }
  | { readonly rejected: string };

export type ItemNormalizer = (item: CollectedItem) => NormalizedItem;

/**
 * Drives a per-provider normaliser over a batch.
 *
 * Anything thrown by the normaliser — a validation failure, a malformed
 * payload, a bug — becomes a rejection with a reason rather than an exception,
 * because losing a whole scan to one bad item is a far worse outcome than
 * losing the item.
 */
export function normalizeItems(
  items: readonly CollectedItem[],
  normalizer: ItemNormalizer,
): NormalizationResult {
  const posts: NormalizedPost[] = [];
  const comments: NormalizedComment[] = [];
  const rejected: { sourceItemId: string; reason: string }[] = [];

  for (const item of items) {
    let result: NormalizedItem;
    try {
      result = normalizer(item);
    } catch (error) {
      rejected.push({ sourceItemId: item.sourceItemId, reason: describeRejection(error) });
      continue;
    }

    if ('post' in result) posts.push(result.post);
    else if ('comment' in result) comments.push(result.comment);
    else rejected.push({ sourceItemId: item.sourceItemId, reason: result.rejected });
  }

  return { posts, comments, rejected };
}

function describeRejection(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  if (error instanceof Error) return `Normalisation failed: ${error.message}`;
  return 'Normalisation failed for an unknown reason.';
}

/** Formats a Zod failure into a short, storable rejection reason. */
export function rejectionFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  const summary = issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  return `The payload did not match the provider schema (${summary}).`;
}
