import { z } from 'zod';

/**
 * The X payload contract.
 *
 * Only the fields this platform reads are described, and every one of them is
 * optional unless the item is meaningless without it. A provider is free to add
 * fields, rename things it never documented and stop sending a metric block for
 * some accounts; none of that may reject an otherwise usable post.
 */

export const xPublicMetricsSchema = z.object({
  like_count: z.number().optional(),
  reply_count: z.number().optional(),
  retweet_count: z.number().optional(),
  quote_count: z.number().optional(),
  impression_count: z.number().optional(),
});

export const xUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().optional(),
  name: z.string().optional(),
});

export type XUser = z.infer<typeof xUserSchema>;

/**
 * One post as this package stores it.
 *
 * The live adapter folds the matching entry from `includes.users` into
 * `author` before the item is persisted. The response format keeps authors in a
 * side-car so that a shared author is sent once, but a stored item has to be
 * reprocessable on its own years later, when the side-car is long gone.
 */
export const xPostSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  created_at: z.string().min(1),
  lang: z.string().optional(),
  author_id: z.string().optional(),
  conversation_id: z.string().optional(),
  public_metrics: xPublicMetricsSchema.optional(),
  author: xUserSchema.optional(),
});

export type XPost = z.infer<typeof xPostSchema>;

/** The `GET /2/tweets/search/recent` envelope. */
export const xSearchResponseSchema = z.object({
  data: z.array(xPostSchema.omit({ author: true })).optional(),
  includes: z.object({ users: z.array(xUserSchema).optional() }).optional(),
  meta: z
    .object({
      next_token: z.string().optional(),
      result_count: z.number().optional(),
    })
    .optional(),
  errors: z
    .array(z.object({ title: z.string().optional(), detail: z.string().optional() }))
    .optional(),
});

/** Operator-supplied settings for this source. */
export const xConfigSchema = z.object({
  /** Search queries, each collected in turn until the limit is reached. */
  queries: z.array(z.string().trim().min(1)).min(1).max(10).default(['ai agents']),
  /** Items requested per page; the provider caps this well below our limit. */
  pageSize: z.number().int().min(10).max(100).default(100),
  /** Excludes retweets and replies, which are mostly noise for trend detection. */
  excludeRetweets: z.boolean().default(true),
});

export type XConfig = z.infer<typeof xConfigSchema>;

export const X_CONFIG_DEFAULTS: XConfig = {
  queries: ['ai agents'],
  pageSize: 100,
  excludeRetweets: true,
};
