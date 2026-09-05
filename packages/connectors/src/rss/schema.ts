import { z } from 'zod';

/**
 * The stored shape of a feed article.
 *
 * Unlike the other four connectors there is no provider JSON to preserve: the
 * document is XML and the useful part of it is what the parser extracted. The
 * payload is therefore the parsed entry plus enough about its feed to
 * reprocess it later without going back to the network.
 */
export const rssItemSchema = z.object({
  feedUrl: z.string().min(1),
  feedTitle: z.string().optional(),
  id: z.string().min(1),
  title: z.string(),
  link: z.string(),
  summary: z.string().optional(),
  content: z.string().optional(),
  author: z.string().nullish(),
  /** Raw date string exactly as the feed published it. */
  publishedAt: z.string().nullish(),
  categories: z.array(z.string()).optional(),
});

export type RssItem = z.infer<typeof rssItemSchema>;

export const rssConfigSchema = z.object({
  feedUrls: z.array(z.string().trim().min(1)).min(1).max(50),
  /** Entries taken from any one feed, so a large feed cannot fill the scan. */
  itemsPerFeed: z.number().int().min(1).max(100).default(25),
  /** Bytes accepted from one feed document. */
  maxBytes: z
    .number()
    .int()
    .min(1_024)
    .max(16 * 1024 * 1024)
    .default(4 * 1024 * 1024),
});

export type RssConfig = z.infer<typeof rssConfigSchema>;

export const RSS_CONFIG_DEFAULTS: RssConfig = {
  feedUrls: [],
  itemsPerFeed: 25,
  maxBytes: 4 * 1024 * 1024,
};
