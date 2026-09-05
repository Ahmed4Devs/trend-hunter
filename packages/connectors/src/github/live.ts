import type { CollectedItem } from '@trendhunter/types';

import {
  BaseConnector,
  readConnectorConfig,
  type CollectionContext,
  type ConnectorOptions,
} from '../connector';
import { HttpClient, type HttpClientOptions } from '../http';

import {
  GITHUB_CONFIG_DEFAULTS,
  githubConfigSchema,
  githubReleaseListSchema,
  githubRepositoryResponseSchema,
  githubSearchResponseSchema,
  type GithubConfig,
} from './schema';

/**
 * Live GitHub adapter.
 *
 * Two shapes are collected. Watched repositories are fetched by name and, when
 * enabled, their most recent releases; configured topics are searched for
 * repositories that changed recently. Releases carry their repository's name,
 * language and star count folded in, because a stored item has to be
 * reprocessable years later without a second lookup.
 *
 * The token is optional: unauthenticated requests work and are simply rate
 * limited far harder, which is the right default for a self-hosted deployment
 * whose operator has not configured one.
 */

const API_ORIGIN = 'https://api.github.com';

/** Releases fetched per watched repository. */
const RELEASES_PER_REPOSITORY = 5;

export interface GithubLiveOptions extends ConnectorOptions {
  /** Personal access token. Sent as a bearer credential; never logged. */
  readonly token?: string | undefined;
  readonly http?: Partial<HttpClientOptions>;
}

export class GithubLiveConnector extends BaseConnector {
  readonly source = 'GITHUB' as const;
  readonly name = 'github:http';

  readonly #client: HttpClient;
  readonly #token: string | undefined;

  constructor(options: GithubLiveOptions) {
    super(options);
    this.#token = options.token;
    this.#client = new HttpClient({
      userAgent: 'TrendHunter/1.0 (content trend collector)',
      ...options.http,
    });
  }

  protected async collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const config = readConnectorConfig(context, githubConfigSchema, GITHUB_CONFIG_DEFAULTS);
    const items: CollectedItem[] = [];
    const seen = new Set<string>();

    await this.#collectSearched(context, config, items, seen);
    await this.#collectWatched(context, config, items, seen);

    return items;
  }

  /** Repositories discovered by topic search, most recently updated first. */
  async #collectSearched(
    context: CollectionContext,
    config: GithubConfig,
    items: CollectedItem[],
    seen: Set<string>,
  ): Promise<void> {
    for (const topic of config.topics) {
      if (context.isSatisfied(items.length)) return;
      context.throwIfAborted();

      const query = new URLSearchParams({
        q: `topic:${topic} stars:>=${String(config.minStars)}`,
        sort: 'updated',
        order: 'desc',
        per_page: String(Math.min(50, Math.max(1, context.remaining(items.length)))),
      });

      let response;
      try {
        response = await this.#client.requestJson(
          {
            url: `${API_ORIGIN}/search/repositories?${query.toString()}`,
            provider: 'github',
            accept: 'application/vnd.github+json',
            headers: this.#headers(),
            signal: context.signal,
            onAttempt: () => {
              context.countRequest();
            },
          },
          githubSearchResponseSchema,
        );
      } catch {
        // One unusable topic must not abandon the others.
        context.warn(`The GitHub search for topic "${topic}" failed and was skipped.`);
        continue;
      }

      for (const repository of response.items) {
        if (context.isSatisfied(items.length)) return;
        if (seen.has(repository.full_name)) continue;
        if (!this.#isRecentEnough(context, repository.pushed_at)) continue;

        seen.add(repository.full_name);
        items.push(this.#repositoryItem(context, repository));
      }
    }
  }

  /** Repositories the operator named explicitly, plus their releases. */
  async #collectWatched(
    context: CollectionContext,
    config: GithubConfig,
    items: CollectedItem[],
    seen: Set<string>,
  ): Promise<void> {
    for (const fullName of config.repositories) {
      if (context.isSatisfied(items.length)) return;
      context.throwIfAborted();

      if (!seen.has(fullName)) {
        try {
          const repository = await this.#client.requestJson(
            {
              url: `${API_ORIGIN}/repos/${fullName}`,
              provider: 'github',
              accept: 'application/vnd.github+json',
              headers: this.#headers(),
              signal: context.signal,
              onAttempt: () => {
                context.countRequest();
              },
            },
            githubRepositoryResponseSchema,
          );
          seen.add(fullName);
          if (this.#isRecentEnough(context, repository.pushed_at)) {
            items.push(this.#repositoryItem(context, repository));
          }

          if (config.includeReleases && !context.isSatisfied(items.length)) {
            await this.#collectReleases(context, fullName, repository, items);
          }
        } catch {
          context.warn(`The GitHub repository "${fullName}" could not be read and was skipped.`);
        }
      }
    }
  }

  async #collectReleases(
    context: CollectionContext,
    fullName: string,
    repository: { language?: string | null; topics?: string[]; stargazers_count?: number },
    items: CollectedItem[],
  ): Promise<void> {
    let releases;
    try {
      releases = await this.#client.requestJson(
        {
          url: `${API_ORIGIN}/repos/${fullName}/releases?per_page=${String(RELEASES_PER_REPOSITORY)}`,
          provider: 'github',
          accept: 'application/vnd.github+json',
          headers: this.#headers(),
          signal: context.signal,
          onAttempt: () => {
            context.countRequest();
          },
        },
        githubReleaseListSchema,
      );
    } catch {
      context.warn(`Releases for "${fullName}" could not be read and were skipped.`);
      return;
    }

    for (const release of releases) {
      if (context.isSatisfied(items.length)) return;
      if (release.draft === true) continue;
      if (!this.#isRecentEnough(context, release.published_at ?? release.created_at)) continue;

      items.push(
        this.item(context, {
          sourceItemId: `release:${String(release.id)}`,
          kind: 'post',
          payload: {
            ...release,
            kind: 'release',
            repository_full_name: fullName,
            repository_language: repository.language ?? null,
            repository_topics: repository.topics ?? [],
            repository_stars: repository.stargazers_count ?? 0,
          },
        }),
      );
    }
  }

  #repositoryItem(
    context: CollectionContext,
    repository: { id: number | string; full_name: string },
  ): CollectedItem {
    return this.item(context, {
      sourceItemId: `repo:${String(repository.id)}`,
      kind: 'post',
      payload: { ...repository, kind: 'repository' },
    });
  }

  #isRecentEnough(context: CollectionContext, timestamp: string | null | undefined): boolean {
    if (context.since === undefined) return true;
    if (timestamp === null || timestamp === undefined) return true;
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) || parsed >= context.since.getTime();
  }

  #headers(): Record<string, string> {
    return {
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.#token === undefined || this.#token === ''
        ? {}
        : { Authorization: `Bearer ${this.#token}` }),
    };
  }
}
