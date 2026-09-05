import { Buffer } from 'node:buffer';

import { UpstreamError } from '@trendhunter/shared';
import type { CollectedItem } from '@trendhunter/types';
import type { z, ZodType } from 'zod';

import {
  BaseConnector,
  readConnectorConfig,
  type CollectionContext,
  type ConnectorOptions,
} from '../connector';
import { HttpClient, type HttpClientOptions } from '../http';

import {
  redditCommentSchema,
  redditCommentsResponseSchema,
  redditConfigSchema,
  redditListingSchema,
  redditSubmissionSchema,
  redditTokenSchema,
  REDDIT_CONFIG_DEFAULTS,
  submissionFullname,
  type RedditConfig,
  type RedditSubmission,
} from './schema';

/**
 * Live Reddit adapter.
 *
 * Uses the application-only OAuth flow: the token is fetched once, cached until
 * shortly before it expires and never logged. Listings are read from the OAuth
 * host because the anonymous JSON endpoints are rate limited to the point of
 * uselessness for a scheduled collector.
 *
 * Comments are fetched only for the most engaged submissions of a page, and
 * only at top level. Depth costs a request per level for material that is
 * mostly reaction; the top-level replies are where the problems are stated.
 */

const TOKEN_ENDPOINT = 'https://www.reddit.com/api/v1/access_token';
const API_ORIGIN = 'https://oauth.reddit.com';

/** Refresh a little before expiry so a long scan cannot straddle the boundary. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export interface RedditLiveOptions extends ConnectorOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly http?: Partial<HttpClientOptions>;
}

export class RedditLiveConnector extends BaseConnector {
  readonly source = 'REDDIT' as const;
  readonly name = 'reddit:http';

  readonly #client: HttpClient;
  readonly #credentials: string;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(options: RedditLiveOptions) {
    super(options);
    if (options.clientId.trim() === '' || options.clientSecret.trim() === '') {
      throw new UpstreamError('reddit', 'Reddit client credentials are required in live mode.');
    }
    this.#credentials = Buffer.from(`${options.clientId}:${options.clientSecret}`, 'utf8').toString(
      'base64',
    );
    this.#client = new HttpClient({
      // Reddit rejects generic user agents outright, so this is not decoration.
      userAgent: 'TrendHunter/1.0 (content trend collector)',
      ...options.http,
    });
  }

  protected async collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const config = readConnectorConfig(context, redditConfigSchema, REDDIT_CONFIG_DEFAULTS);
    const items: CollectedItem[] = [];

    for (const subreddit of config.subreddits) {
      if (context.isSatisfied(items.length)) break;
      context.throwIfAborted();

      const submissions = await this.#collectSubmissions(context, config, subreddit, items);
      if (!config.includeComments || config.commentsPerPost === 0) continue;

      // Comments are worth a request only where a discussion actually happened.
      const discussed = [...submissions]
        .filter((submission) => (submission.num_comments ?? 0) > 1)
        .sort((a, b) => (b.num_comments ?? 0) - (a.num_comments ?? 0))
        .slice(0, config.commentedPostLimit);

      for (const submission of discussed) {
        if (context.isSatisfied(items.length)) break;
        await this.#collectComments(context, config, subreddit, submission, items);
      }
    }

    return items;
  }

  async #collectSubmissions(
    context: CollectionContext,
    config: RedditConfig,
    subreddit: string,
    items: CollectedItem[],
  ): Promise<RedditSubmission[]> {
    const url = new URL(`${API_ORIGIN}/r/${encodeURIComponent(subreddit)}/${config.listing}`);
    url.searchParams.set('limit', String(Math.min(100, Math.max(1, context.limit))));
    url.searchParams.set('raw_json', '1');

    const listing = await this.#request(context, url, redditListingSchema);
    const submissions: RedditSubmission[] = [];

    for (const child of listing.data.children) {
      if (child.kind !== 't3') continue;
      const parsed = redditSubmissionSchema.safeParse(child.data);
      if (!parsed.success) {
        context.warn(`A submission in r/${subreddit} did not match the expected shape.`);
        continue;
      }
      const submission = parsed.data;
      if (config.excludeStickied && submission.stickied === true) continue;
      if (context.since && submission.created_utc * 1000 < context.since.getTime()) continue;

      submissions.push(submission);
      if (context.isSatisfied(items.length)) continue;
      items.push(
        this.item(context, {
          sourceItemId: submissionFullname(submission),
          kind: 'post',
          payload: { ...submission },
        }),
      );
    }

    return submissions;
  }

  async #collectComments(
    context: CollectionContext,
    config: RedditConfig,
    subreddit: string,
    submission: RedditSubmission,
    items: CollectedItem[],
  ): Promise<void> {
    const url = new URL(
      `${API_ORIGIN}/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(submission.id)}`,
    );
    url.searchParams.set('limit', String(config.commentsPerPost));
    url.searchParams.set('depth', '1');
    url.searchParams.set('sort', 'top');
    url.searchParams.set('raw_json', '1');

    let listings: z.infer<typeof redditCommentsResponseSchema>;
    try {
      listings = await this.#request(context, url, redditCommentsResponseSchema);
    } catch (error) {
      // One unreachable thread must not lose the submissions already collected.
      context.warn(`Comments for ${submissionFullname(submission)} could not be collected.`);
      this.logger.debug({ err: error, connector: this.name }, 'reddit comment fetch failed');
      return;
    }

    const commentListing = listings[1] ?? listings[0];
    if (!commentListing) return;

    let taken = 0;
    for (const child of commentListing.data.children) {
      if (child.kind !== 't1' || taken >= config.commentsPerPost) continue;
      const parsed = redditCommentSchema.safeParse(child.data);
      if (!parsed.success) continue;
      if (context.isSatisfied(items.length)) return;

      taken += 1;
      items.push(
        this.item(context, {
          sourceItemId: parsed.data.name ?? `t1_${parsed.data.id}`,
          kind: 'comment',
          parentSourceItemId: submissionFullname(submission),
          payload: { ...parsed.data },
        }),
      );
    }
  }

  async #request<T>(context: CollectionContext, url: URL, schema: ZodType<T>): Promise<T> {
    const token = await this.#accessToken(context);
    return this.#client.requestJson(
      {
        url: url.toString(),
        provider: 'reddit',
        headers: { authorization: `Bearer ${token}` },
        signal: context.signal,
        onAttempt: () => {
          context.countRequest();
        },
      },
      schema,
    );
  }

  /** Fetches and caches an application-only access token. */
  async #accessToken(context: CollectionContext): Promise<string> {
    const cached = this.#token;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const token = await this.#client.requestJson(
      {
        url: TOKEN_ENDPOINT,
        provider: 'reddit',
        method: 'POST',
        headers: {
          authorization: `Basic ${this.#credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: context.signal,
        onAttempt: () => {
          context.countRequest();
        },
      },
      redditTokenSchema,
    );

    const lifetimeMs = (token.expires_in ?? 3600) * 1000;
    this.#token = {
      value: token.access_token,
      expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_EXPIRY_MARGIN_MS),
    };
    return token.access_token;
  }
}
