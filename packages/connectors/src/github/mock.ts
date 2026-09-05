import type { CollectedItem } from '@trendhunter/types';

import {
  BaseConnector,
  DEFAULT_MOCK_SEED,
  DEFAULT_MOCK_VOLUME,
  type CollectionContext,
  type MockConnectorOptions,
} from '../connector';
import {
  createRandom,
  engagementFor,
  planSlots,
  TAIL_REPOSITORIES,
  type MockSlot,
  type Random,
} from '../mock-data';

/**
 * Offline GitHub adapter.
 *
 * GitHub is the sparsest of the five sources and deliberately so. Only seeds
 * that actually carry a repository produce items, because a story about a
 * funding round has no GitHub presence — and a corpus where every event appears
 * on all five sources would make the cross-source signal meaningless.
 *
 * It is also the only English-only source here: repository metadata and release
 * notes are written in English even by Arabic-speaking maintainers, which is
 * part of what creates the Arabic coverage gap the product exists to find.
 */
export class GithubMockConnector extends BaseConnector {
  readonly source = 'GITHUB' as const;
  readonly name = 'github:mock';

  readonly #seed: string;
  readonly #volume: number;

  constructor(options: MockConnectorOptions) {
    super(options);
    this.#seed = options.seed ?? DEFAULT_MOCK_SEED;
    // A quarter of the usual volume: repositories and releases are events, not
    // conversation, and they arrive far less often than posts do.
    this.#volume = options.volume ?? Math.round(DEFAULT_MOCK_VOLUME / 4);
  }

  protected collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const random = createRandom(`${this.#seed}:github`);
    const slots = planSlots({
      random,
      now: context.collectedAt,
      count: this.#volume,
      tailShare: 0.35,
      arabicShare: 0,
      topicFilter: (topic) => topic.repository !== undefined,
    });

    const items: CollectedItem[] = [];
    const seenRepositories = new Set<string>();

    for (const slot of slots) {
      if (context.since && slot.publishedAt < context.since) continue;
      if (context.isSatisfied(items.length)) break;

      const repository = this.#repositoryFor(random, slot);
      if (repository === null) continue;

      const fullName = `${repository.owner}/${repository.name}`;

      // A repository is one row however many times it comes up in the plan;
      // duplicating it would inflate the source's post count and let one
      // project dominate the cross-source signal on its own.
      if (!seenRepositories.has(fullName)) {
        seenRepositories.add(fullName);
        items.push(this.#repositoryItem(context, random, slot, repository, fullName));
      }

      if (
        repository.releaseTag !== undefined &&
        !context.isSatisfied(items.length) &&
        random.bool(0.7)
      ) {
        items.push(this.#releaseItem(context, random, slot, repository, fullName));
      }
    }

    return Promise.resolve(items);
  }

  /**
   * The repository behind a slot.
   *
   * Topic slots carry their own repository; background slots borrow one from
   * the unrelated pool, which is what keeps GitHub from looking like a perfect
   * index of the event corpus.
   */
  #repositoryFor(
    random: Random,
    slot: MockSlot,
  ): {
    owner: string;
    name: string;
    description: string;
    language: string;
    topics: readonly string[];
    releaseTag?: string;
    releaseTitle?: string;
    releaseNotes?: string;
  } | null {
    if (slot.topic?.repository) return { ...slot.topic.repository };
    if (slot.tail === null) return null;
    const tail = random.pick(TAIL_REPOSITORIES);
    return { ...tail };
  }

  #repositoryItem(
    context: CollectionContext,
    random: Random,
    slot: MockSlot,
    repository: { owner: string; description: string; language: string; topics: readonly string[] },
    fullName: string,
  ): CollectedItem {
    const stars = engagementFor(random, slot, { base: 12, ceiling: 48_000, exponent: 1.5 });
    const id = String(120_000_000 + slot.ordinal * 3187);

    return this.item(context, {
      sourceItemId: `repo:${id}`,
      kind: 'post',
      payload: {
        kind: 'repository',
        id: Number(id),
        full_name: fullName,
        name: fullName.split('/')[1],
        description: repository.description,
        html_url: `https://github.com/${fullName}`,
        language: repository.language,
        topics: [...repository.topics],
        stargazers_count: stars,
        // Forks and issues track stars with wide variance, the way they do on
        // real projects: a popular library has proportionally fewer forks than
        // a popular template.
        forks_count: Math.round(stars * (0.04 + random.next() * 0.22)),
        open_issues_count: Math.round(stars * (0.01 + random.next() * 0.08)),
        watchers_count: stars,
        pushed_at: slot.publishedAt.toISOString(),
        created_at: new Date(
          slot.publishedAt.getTime() - random.int(30, 900) * 86_400_000,
        ).toISOString(),
        owner: { login: repository.owner, html_url: `https://github.com/${repository.owner}` },
      },
    });
  }

  #releaseItem(
    context: CollectionContext,
    random: Random,
    slot: MockSlot,
    repository: {
      owner: string;
      language: string;
      topics: readonly string[];
      releaseTag?: string;
      releaseTitle?: string;
      releaseNotes?: string;
    },
    fullName: string,
  ): CollectedItem {
    const tag = repository.releaseTag ?? `v0.${String(1 + (slot.ordinal % 9))}.0`;
    const id = String(240_000_000 + slot.ordinal * 5077);
    const stars = engagementFor(random, slot, { base: 12, ceiling: 48_000, exponent: 1.5 });

    return this.item(context, {
      sourceItemId: `release:${id}`,
      kind: 'post',
      payload: {
        kind: 'release',
        id: Number(id),
        repository_full_name: fullName,
        tag_name: tag,
        name: repository.releaseTitle ?? `${fullName} ${tag}`,
        body:
          repository.releaseNotes ??
          `Maintenance release. ${
            slot.topic?.bodies[0] ?? 'Dependency updates and fixes reported since the last tag.'
          }`,
        html_url: `https://github.com/${fullName}/releases/tag/${tag}`,
        draft: false,
        prerelease: tag.includes('rc') || tag.includes('beta'),
        published_at: slot.publishedAt.toISOString(),
        created_at: slot.publishedAt.toISOString(),
        author: { login: repository.owner, html_url: `https://github.com/${repository.owner}` },
        reactions: {
          total_count: Math.round(stars * (0.005 + random.next() * 0.03)),
        },
        repository_language: repository.language,
        repository_topics: [...repository.topics],
        repository_stars: stars,
      },
    });
  }
}
