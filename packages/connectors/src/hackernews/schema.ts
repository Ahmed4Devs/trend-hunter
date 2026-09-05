import { z } from 'zod';

/**
 * The Hacker News (Firebase) payload contract.
 *
 * The API is a thin view over a document store, so almost every field is
 * optional and a missing item is `null` rather than a 404. Both facts are
 * modelled here rather than being discovered at runtime.
 */

export const hackerNewsItemSchema = z.object({
  id: z.number(),
  type: z.string().optional(),
  by: z.string().optional(),
  time: z.number(),
  title: z.string().optional(),
  /** Present on Ask HN and self-posts. HTML, not plain text. */
  text: z.string().optional(),
  url: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  kids: z.array(z.number()).optional(),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

export type HackerNewsItem = z.infer<typeof hackerNewsItemSchema>;

/** A deleted or never-existing id answers with a bare `null`. */
export const hackerNewsItemResponseSchema = hackerNewsItemSchema.nullable();

/** Story lists are a flat array of ids, up to five hundred long. */
export const hackerNewsIdListSchema = z.array(z.number()).max(1000);

export const HACKERNEWS_FEEDS = ['top', 'new', 'best', 'ask', 'show'] as const;
export type HackerNewsFeed = (typeof HACKERNEWS_FEEDS)[number];

export const hackerNewsConfigSchema = z.object({
  feeds: z.array(z.enum(HACKERNEWS_FEEDS)).min(1).max(5).default(['top', 'best']),
  /** Stories below this score are noise at collection time. */
  minScore: z.number().int().min(0).max(10_000).default(0),
  /** Cap on item lookups per feed, because each id costs one request. */
  itemsPerFeed: z.number().int().min(1).max(200).default(60),
});

export type HackerNewsConfig = z.infer<typeof hackerNewsConfigSchema>;

export const HACKERNEWS_CONFIG_DEFAULTS: HackerNewsConfig = {
  feeds: ['top', 'best'],
  minScore: 0,
  itemsPerFeed: 60,
};
