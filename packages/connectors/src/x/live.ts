import { UpstreamError } from '@trendhunter/shared';
import type { CollectedItem } from '@trendhunter/types';

import {
  BaseConnector,
  readConnectorConfig,
  type CollectionContext,
  type ConnectorOptions,
} from '../connector';
import { HttpClient, type HttpClientOptions } from '../http';

import { xConfigSchema, xSearchResponseSchema, X_CONFIG_DEFAULTS, type XUser } from './schema';

/**
 * Live X adapter, reading the recent search endpoint.
 *
 * Two provider details shape this code. Authors arrive in a side-car
 * (`includes.users`) and are folded into each item, because a stored payload
 * has to be reprocessable on its own. And the endpoint returns a partial
 * success — items *and* an `errors` array — often enough that treating the
 * presence of errors as a failure would discard usable posts; they become
 * warnings instead.
 */

const SEARCH_ENDPOINT = 'https://api.x.com/2/tweets/search/recent';

/** Paging stops here regardless of the limit, to bound one scan's API spend. */
const MAX_PAGES = 5;

const TWEET_FIELDS = 'created_at,public_metrics,lang,author_id,conversation_id';
const USER_FIELDS = 'username,name';

export interface XLiveOptions extends ConnectorOptions {
  readonly bearerToken: string;
  readonly http?: Partial<HttpClientOptions>;
}

export class XLiveConnector extends BaseConnector {
  readonly source = 'X' as const;
  readonly name = 'x:http';

  readonly #client: HttpClient;
  readonly #bearerToken: string;

  constructor(options: XLiveOptions) {
    super(options);
    if (options.bearerToken.trim() === '') {
      throw new UpstreamError('x', 'An X API bearer token is required in live mode.');
    }
    this.#bearerToken = options.bearerToken;
    this.#client = new HttpClient({
      userAgent: 'TrendHunter/1.0 (+connectors)',
      ...options.http,
    });
  }

  protected async collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const config = readConnectorConfig(context, xConfigSchema, X_CONFIG_DEFAULTS);
    const items: CollectedItem[] = [];
    const seen = new Set<string>();

    for (const query of config.queries) {
      if (context.isSatisfied(items.length)) break;
      await this.#collectQuery(context, config.excludeRetweets ? excludeNoise(query) : query, {
        config,
        items,
        seen,
      });
    }

    return items;
  }

  async #collectQuery(
    context: CollectionContext,
    query: string,
    state: {
      config: { pageSize: number };
      items: CollectedItem[];
      seen: Set<string>;
    },
  ): Promise<void> {
    let nextToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      context.throwIfAborted();
      if (context.isSatisfied(state.items.length)) return;

      const url = new URL(SEARCH_ENDPOINT);
      url.searchParams.set('query', query);
      url.searchParams.set(
        'max_results',
        String(
          Math.min(state.config.pageSize, Math.max(10, context.remaining(state.items.length))),
        ),
      );
      url.searchParams.set('tweet.fields', TWEET_FIELDS);
      url.searchParams.set('expansions', 'author_id');
      url.searchParams.set('user.fields', USER_FIELDS);
      if (context.since) url.searchParams.set('start_time', context.since.toISOString());
      if (nextToken !== undefined) url.searchParams.set('next_token', nextToken);

      const response = await this.#client.requestJson(
        {
          url: url.toString(),
          provider: 'x',
          headers: { authorization: `Bearer ${this.#bearerToken}` },
          signal: context.signal,
          onAttempt: () => {
            context.countRequest();
          },
        },
        xSearchResponseSchema,
      );

      for (const error of response.errors ?? []) {
        context.warn(`X reported a partial failure: ${error.title ?? error.detail ?? 'unknown'}`);
      }

      const users = new Map<string, XUser>();
      for (const user of response.includes?.users ?? []) users.set(user.id, user);

      const posts = response.data ?? [];
      for (const post of posts) {
        if (state.seen.has(post.id)) continue;
        state.seen.add(post.id);
        if (context.isSatisfied(state.items.length)) return;

        const author = post.author_id === undefined ? undefined : users.get(post.author_id);
        state.items.push(
          this.item(context, {
            sourceItemId: post.id,
            kind: 'post',
            payload: { ...post, ...(author ? { author } : {}) },
          }),
        );
      }

      nextToken = response.meta?.next_token;
      if (nextToken === undefined || posts.length === 0) return;
    }
  }
}

/**
 * Filters retweets and replies out of a query.
 *
 * Both are overwhelmingly restatements, and counting them would let one popular
 * post masquerade as a broad conversation in the cross-source signal.
 */
function excludeNoise(query: string): string {
  return `${query} -is:retweet -is:reply`;
}
