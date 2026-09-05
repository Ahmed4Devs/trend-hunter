import { UpstreamError } from '@trendhunter/shared';
import type { CollectedItem } from '@trendhunter/types';

import {
  BaseConnector,
  readConnectorConfig,
  type CollectionContext,
  type ConnectorOptions,
} from '../connector';
import { HttpClient, type HttpClientOptions } from '../http';

import { parseFeed, type ParsedFeedItem } from './parser';
import { RSS_CONFIG_DEFAULTS, rssConfigSchema } from './schema';

/**
 * Live RSS adapter.
 *
 * This is the connector with the widest attack surface in the platform: the
 * URLs it fetches come from operator-editable source configuration, so an
 * unguarded request here would let a stored feed URL reach PostgreSQL, Redis,
 * the API itself or a cloud metadata endpoint. Every request therefore goes
 * through {@link HttpClient}, which re-validates the target against the SSRF
 * guard on every hop including redirects, bounds the response size, and refuses
 * anything that is not http(s) on an allowed port.
 *
 * A feed that fails — unreachable, malformed, or simply enormous — produces a
 * warning on the scan and nothing else. One broken publication must not stop
 * the other forty-nine from being collected.
 */

export interface RssLiveOptions extends ConnectorOptions {
  readonly http?: Partial<HttpClientOptions>;
}

export class RssLiveConnector extends BaseConnector {
  readonly source = 'RSS' as const;
  readonly name = 'rss:http';

  readonly #client: HttpClient;

  constructor(options: RssLiveOptions) {
    super(options);
    this.#client = new HttpClient({
      userAgent: 'TrendHunter/1.0 (+content trend collector)',
      ...options.http,
    });
  }

  protected async collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const config = readConnectorConfig(context, rssConfigSchema, RSS_CONFIG_DEFAULTS);
    if (config.feedUrls.length === 0) {
      context.warn('No feed URLs are configured for this source.');
      return [];
    }

    const items: CollectedItem[] = [];
    const seen = new Set<string>();

    for (const feedUrl of config.feedUrls) {
      if (context.isSatisfied(items.length)) break;
      context.throwIfAborted();

      const feed = await this.#loadFeed(context, feedUrl, config.maxBytes);
      if (feed === null) continue;

      let takenFromFeed = 0;
      for (const entry of feed.items) {
        if (context.isSatisfied(items.length)) break;
        if (takenFromFeed >= config.itemsPerFeed) break;

        const item = this.#toItem(context, feedUrl, feed.title, entry);
        if (item === null) continue;

        // The same article routinely appears in several feeds of the same
        // publication; keeping one copy per scan saves the deduplication layer
        // work it would otherwise do a round trip to discover.
        const key = `${entry.id}|${entry.link}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push(item);
        takenFromFeed += 1;
      }
    }

    return items;
  }

  /** Fetches and parses one feed, or returns `null` after recording a warning. */
  async #loadFeed(
    context: CollectionContext,
    feedUrl: string,
    maxBytes: number,
  ): Promise<{ title: string; items: readonly ParsedFeedItem[] } | null> {
    try {
      const response = await this.#client.requestText({
        url: feedUrl,
        provider: 'rss',
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
        signal: context.signal,
        onAttempt: () => {
          context.countRequest();
        },
      });

      if (response.status >= 400) {
        throw new UpstreamError('rss', `The feed answered ${String(response.status)}.`);
      }
      if (response.body.length > maxBytes) {
        throw new UpstreamError('rss', 'The feed document exceeded the configured size limit.');
      }

      const feed = parseFeed(response.body);
      return { title: feed.title, items: feed.items };
    } catch (error) {
      // Aborts belong to the scheduler, not to the feed.
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // The URL is included because an operator needs to know which feed to
      // fix; the underlying message is not, because it can echo response bodies.
      context.warn(`The feed at ${safeFeedLabel(feedUrl)} could not be read and was skipped.`);
      return null;
    }
  }

  #toItem(
    context: CollectionContext,
    feedUrl: string,
    feedTitle: string,
    entry: ParsedFeedItem,
  ): CollectedItem | null {
    const link = entry.link.trim();
    if (link === '') return null;

    if (context.since !== undefined && entry.publishedAt !== null) {
      const published = Date.parse(entry.publishedAt);
      if (!Number.isNaN(published) && published < context.since.getTime()) return null;
    }

    return this.item(context, {
      // Feed ids are only unique within their feed, so the stored identifier
      // carries the feed with it.
      sourceItemId: `${feedUrl}#${entry.id}`,
      kind: 'post',
      payload: {
        feedUrl,
        feedTitle,
        id: entry.id,
        title: entry.title,
        link,
        summary: entry.summary,
        content: entry.content,
        author: entry.author,
        publishedAt: entry.publishedAt,
        categories: [...entry.categories],
      },
    });
  }
}

/** A feed URL reduced to origin and path, so a query string cannot leak a token. */
function safeFeedLabel(feedUrl: string): string {
  try {
    const url = new URL(feedUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'the configured URL';
  }
}
