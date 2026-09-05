import type { ContentConnector, DataMode, NormalizationResult, SourceKind } from '@trendhunter/types';
import type { CollectedItem } from '@trendhunter/types';
import { assertNever, UpstreamError } from '@trendhunter/shared';
import type { Logger } from '@trendhunter/observability';

import type { HttpClientOptions } from './http';
import { GithubLiveConnector } from './github/live';
import { GithubMockConnector } from './github/mock';
import { normalizeGithubItems } from './github/normalize';
import { HackerNewsLiveConnector } from './hackernews/live';
import { HackerNewsMockConnector } from './hackernews/mock';
import { normalizeHackerNewsItems } from './hackernews/normalize';
import { RedditLiveConnector } from './reddit/live';
import { RedditMockConnector } from './reddit/mock';
import { normalizeRedditItems } from './reddit/normalize';
import { RssMockConnector } from './rss/mock';
import { normalizeRssItems } from './rss/normalize';
import { RssLiveConnector } from './rss/live';
import { XLiveConnector } from './x/live';
import { XMockConnector } from './x/mock';
import { normalizeXItems } from './x/normalize';

/**
 * The connector registry.
 *
 * This is the only place that knows which concrete adapter serves which source.
 * The worker asks for a connector by `SourceKind` and receives something that
 * satisfies `ContentConnector`; it never imports a provider module, which is
 * what keeps provider quirks out of the ingestion pipeline and makes adding
 * YouTube or Product Hunt a change to this file rather than to the pipeline.
 */

/** A credential that is present and non-blank, or `null`. */
function requireCredential(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Stands in for a live connector whose credentials are missing.
 *
 * Constructing the real adapter would throw, and `createAllConnectors` would
 * then fail entirely — one unconfigured provider would stop the other four from
 * collecting. Failing at collection time instead keeps the fault contained to
 * the source it belongs to, where the scan history records it.
 */
class MisconfiguredConnector implements ContentConnector {
  readonly source: SourceKind;
  readonly name: string;
  readonly #requirement: string;

  constructor(source: SourceKind, provider: string, requirement: string) {
    this.source = source;
    this.name = `${provider}:unconfigured`;
    this.#requirement = requirement;
  }

  collect(): Promise<never> {
    return Promise.reject(
      new UpstreamError(
        this.name,
        `${this.source} is enabled in live mode but ${this.#requirement} is not configured.`,
      ),
    );
  }
}

/** Provider credentials, supplied by the composition root from validated env. */
export interface ProviderCredentials {
  readonly xBearerToken?: string | undefined;
  readonly redditClientId?: string | undefined;
  readonly redditClientSecret?: string | undefined;
  readonly githubToken?: string | undefined;
}

export interface ConnectorFactoryOptions {
  readonly mode: DataMode;
  readonly logger: Logger;
  readonly credentials?: ProviderCredentials;
  /** Shared HTTP settings; `allowPrivateNetworks` comes from the environment. */
  readonly http?: Partial<HttpClientOptions>;
  /** Injected clock, so mock generation and `since` filtering stay reproducible. */
  readonly now?: () => Date;
  /** Seed for the offline corpus. The same seed always yields the same items. */
  readonly seed?: string;
  /** Items generated per source before the collection limit is applied. */
  readonly volume?: number;
}

/**
 * Builds the connector for one source.
 *
 * In `mock` mode every source is offline and deterministic, so the whole
 * pipeline runs with no credentials and no network. In `live` mode the HTTP
 * adapters are used; a source whose credentials are missing still returns a
 * connector, and the failure surfaces as an upstream error on that source alone
 * rather than as a start-up crash that takes the other four down with it.
 */
export function createConnector(
  source: SourceKind,
  options: ConnectorFactoryOptions,
): ContentConnector {
  const base = {
    logger: options.logger,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  const mock = {
    ...base,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.volume === undefined ? {} : { volume: options.volume }),
  };
  const live = { ...base, ...(options.http === undefined ? {} : { http: options.http }) };
  const credentials = options.credentials ?? {};
  const isMock = options.mode === 'mock';

  switch (source) {
    case 'X': {
      if (isMock) return new XMockConnector(mock);
      const bearerToken = requireCredential(credentials.xBearerToken);
      return bearerToken === null
        ? new MisconfiguredConnector('X', 'x', 'X_API_BEARER_TOKEN')
        : new XLiveConnector({ ...live, bearerToken });
    }
    case 'REDDIT': {
      if (isMock) return new RedditMockConnector(mock);
      const clientId = requireCredential(credentials.redditClientId);
      const clientSecret = requireCredential(credentials.redditClientSecret);
      return clientId === null || clientSecret === null
        ? new MisconfiguredConnector('REDDIT', 'reddit', 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET')
        : new RedditLiveConnector({ ...live, clientId, clientSecret });
    }
    case 'HACKERNEWS':
      // Hacker News has no credentials: the public API is unauthenticated.
      return isMock ? new HackerNewsMockConnector(mock) : new HackerNewsLiveConnector(live);
    case 'RSS':
      return isMock ? new RssMockConnector(mock) : new RssLiveConnector(live);
    case 'GITHUB':
      return isMock
        ? new GithubMockConnector(mock)
        : new GithubLiveConnector({ ...live, token: credentials.githubToken });
    default:
      return assertNever(source, 'source kind');
  }
}

/** Builds every connector, keyed by source. */
export function createAllConnectors(
  options: ConnectorFactoryOptions,
): Map<SourceKind, ContentConnector> {
  const sources: SourceKind[] = ['X', 'REDDIT', 'HACKERNEWS', 'RSS', 'GITHUB'];
  return new Map(sources.map((source) => [source, createConnector(source, options)]));
}

/**
 * Normalises collected items using the right provider normaliser.
 *
 * Kept beside the registry for the same reason: the pipeline normalises by
 * source without knowing which module does the work.
 */
export function normalizeItemsForSource(
  source: SourceKind,
  items: readonly CollectedItem[],
): NormalizationResult {
  switch (source) {
    case 'X':
      return normalizeXItems(items);
    case 'REDDIT':
      return normalizeRedditItems(items);
    case 'HACKERNEWS':
      return normalizeHackerNewsItems(items);
    case 'RSS':
      return normalizeRssItems(items);
    case 'GITHUB':
      return normalizeGithubItems(items);
    default:
      return assertNever(source, 'source kind');
  }
}
