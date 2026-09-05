import type { CollectedItem } from '@trendhunter/types';

import {
  BaseConnector,
  readConnectorConfig,
  type CollectionContext,
  type ConnectorOptions,
} from '../connector';
import { HttpClient, type HttpClientOptions } from '../http';

import {
  hackerNewsConfigSchema,
  hackerNewsIdListSchema,
  hackerNewsItemResponseSchema,
  HACKERNEWS_CONFIG_DEFAULTS,
  type HackerNewsFeed,
  type HackerNewsItem,
} from './schema';

/**
 * Live Hacker News adapter.
 *
 * The public API has no batch endpoint: a story list is a page of ids and each
 * id costs a request. Lookups therefore run with a small amount of concurrency
 * — enough that a scan finishes in seconds, low enough to stay a polite client
 * of a free, unauthenticated service.
 */

const API_ORIGIN = 'https://hacker-news.firebaseio.com/v0';

const FEED_PATHS: Readonly<Record<HackerNewsFeed, string>> = {
  top: 'topstories',
  new: 'newstories',
  best: 'beststories',
  ask: 'askstories',
  show: 'showstories',
};

const LOOKUP_CONCURRENCY = 6;

export interface HackerNewsLiveOptions extends ConnectorOptions {
  readonly http?: Partial<HttpClientOptions>;
}

export class HackerNewsLiveConnector extends BaseConnector {
  readonly source = 'HACKERNEWS' as const;
  readonly name = 'hackernews:http';

  readonly #client: HttpClient;

  constructor(options: HackerNewsLiveOptions) {
    super(options);
    this.#client = new HttpClient({
      userAgent: 'TrendHunter/1.0 (content trend collector)',
      ...options.http,
    });
  }

  protected async collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const config = readConnectorConfig(context, hackerNewsConfigSchema, HACKERNEWS_CONFIG_DEFAULTS);
    const items: CollectedItem[] = [];
    const seen = new Set<number>();

    for (const feed of config.feeds) {
      if (context.isSatisfied(items.length)) break;
      context.throwIfAborted();

      const ids = await this.#storyIds(context, feed);
      const wanted = ids
        .filter((id) => !seen.has(id))
        .slice(0, Math.min(config.itemsPerFeed, Math.max(1, context.remaining(items.length))));
      for (const id of wanted) seen.add(id);

      const stories = await this.#lookup(context, wanted);
      for (const story of stories) {
        if (context.isSatisfied(items.length)) break;
        if ((story.score ?? 0) < config.minScore) continue;
        if (context.since && story.time * 1000 < context.since.getTime()) continue;

        items.push(
          this.item(context, {
            sourceItemId: String(story.id),
            kind: 'post',
            payload: { ...story },
          }),
        );
      }
    }

    return items;
  }

  async #storyIds(context: CollectionContext, feed: HackerNewsFeed): Promise<number[]> {
    return this.#client.requestJson(
      {
        url: `${API_ORIGIN}/${FEED_PATHS[feed]}.json`,
        provider: 'hackernews',
        signal: context.signal,
        onAttempt: () => {
          context.countRequest();
        },
      },
      hackerNewsIdListSchema,
    );
  }

  /**
   * Resolves ids to stories, preserving list order.
   *
   * Order matters: the feed order *is* the ranking, and a bounded limit must
   * keep the highest-ranked stories rather than whichever request finished
   * first. A missing story answers `null` and is simply dropped.
   */
  async #lookup(context: CollectionContext, ids: readonly number[]): Promise<HackerNewsItem[]> {
    const results = new Array<HackerNewsItem | null>(ids.length).fill(null);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const id = ids[index];
        if (id === undefined) return;
        context.throwIfAborted();

        try {
          results[index] = await this.#client.requestJson(
            {
              url: `${API_ORIGIN}/item/${String(id)}.json`,
              provider: 'hackernews',
              signal: context.signal,
              onAttempt: () => {
                context.countRequest();
              },
            },
            hackerNewsItemResponseSchema,
          );
        } catch {
          context.warn('One or more Hacker News item lookups failed and were skipped.');
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(LOOKUP_CONCURRENCY, ids.length) }, () => worker()),
    );

    return results.filter((story): story is HackerNewsItem => story !== null);
  }
}
