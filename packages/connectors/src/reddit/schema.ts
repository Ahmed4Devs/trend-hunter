import { z } from 'zod';

/**
 * The Reddit payload contract.
 *
 * Reddit identifies everything twice: a short `id` that is only unique within a
 * type, and a `name` — the "fullname", `t3_` for a submission and `t1_` for a
 * comment — that is unique across the site. The fullname is what this package
 * stores, because a comment's `link_id` is a fullname and the two must join.
 */

export const redditSubmissionSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  subreddit: z.string().optional(),
  title: z.string(),
  selftext: z.string().optional(),
  author: z.string().optional(),
  permalink: z.string().optional(),
  url: z.string().optional(),
  created_utc: z.number(),
  score: z.number().optional(),
  ups: z.number().optional(),
  num_comments: z.number().optional(),
  upvote_ratio: z.number().optional(),
  over_18: z.boolean().optional(),
  stickied: z.boolean().optional(),
  is_self: z.boolean().optional(),
});

export type RedditSubmission = z.infer<typeof redditSubmissionSchema>;

export const redditCommentSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  /** Fullname of the submission this comment belongs to, e.g. `t3_1abcde`. */
  link_id: z.string().min(1),
  parent_id: z.string().optional(),
  subreddit: z.string().optional(),
  body: z.string(),
  author: z.string().optional(),
  permalink: z.string().optional(),
  created_utc: z.number(),
  score: z.number().optional(),
  depth: z.number().optional(),
});

export type RedditComment = z.infer<typeof redditCommentSchema>;

const listingChildSchema = z.object({
  kind: z.string(),
  data: z.unknown(),
});

/**
 * A listing envelope.
 *
 * Children are validated one at a time by the caller rather than as an array,
 * so that a single malformed entry — Reddit mixes `more` placeholders in with
 * real comments — does not reject the whole page.
 */
export const redditListingSchema = z.object({
  kind: z.literal('Listing'),
  data: z.object({
    after: z.string().nullable().optional(),
    children: z.array(listingChildSchema),
  }),
});

/** The comments endpoint answers with `[submission listing, comment listing]`. */
export const redditCommentsResponseSchema = z.array(redditListingSchema).min(1);

export const redditTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export const redditConfigSchema = z.object({
  subreddits: z
    .array(z.string().trim().min(1).max(50))
    .min(1)
    .max(15)
    .default(['SaaS', 'startups', 'ExperiencedDevs']),
  listing: z.enum(['hot', 'new', 'top', 'rising']).default('hot'),
  /**
   * Comments are collected because they are where problems and questions
   * surface; a submission title tells you a topic exists, its comments tell you
   * what is actually wrong with it.
   */
  includeComments: z.boolean().default(true),
  commentsPerPost: z.number().int().min(0).max(50).default(8),
  /** Submissions whose comments are fetched, most engaged first. */
  commentedPostLimit: z.number().int().min(0).max(30).default(6),
  excludeStickied: z.boolean().default(true),
});

export type RedditConfig = z.infer<typeof redditConfigSchema>;

export const REDDIT_CONFIG_DEFAULTS: RedditConfig = {
  subreddits: ['SaaS', 'startups', 'ExperiencedDevs'],
  listing: 'hot',
  includeComments: true,
  commentsPerPost: 8,
  commentedPostLimit: 6,
  excludeStickied: true,
};

/** Fullname for a submission, derived when the provider omitted `name`. */
export function submissionFullname(submission: RedditSubmission): string {
  return submission.name ?? `t3_${submission.id}`;
}

export function commentFullname(comment: RedditComment): string {
  return comment.name ?? `t1_${comment.id}`;
}
