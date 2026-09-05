import type { CollectedItem, NormalizedPost, SourceKind } from '@trendhunter/types';
import { describe, expect, it } from 'vitest';

import type { NormalizedItem } from '../src/normalize';
import { normalizeItemsForSource } from '../src/registry';
import { normalizeGithubItem } from '../src/github/normalize';
import { normalizeHackerNewsItem } from '../src/hackernews/normalize';
import { normalizeRedditItem } from '../src/reddit/normalize';
import { normalizeRssItem } from '../src/rss/normalize';
import { normalizeXItem } from '../src/x/normalize';

/**
 * Normalisation is where provider data first becomes something the platform
 * trusts, so every normaliser is tested twice: once against a realistic payload
 * and once against a malformed one. The second case is the important one — a
 * normaliser that throws instead of rejecting would abort an entire collection
 * because of a single bad item.
 */

/**
 * `NormalizedItem` is a discriminated union, so these narrow it and fail the
 * test with a useful message rather than an `undefined` property access.
 */
function expectPost(result: NormalizedItem): NormalizedPost {
  if (!('post' in result)) {
    throw new Error(
      `expected a normalised post, got ${'rejected' in result ? result.rejected : 'a comment'}`,
    );
  }
  return result.post;
}

function expectRejection(result: NormalizedItem): string {
  if (!('rejected' in result)) throw new Error('expected the item to be rejected');
  return result.rejected;
}

const COLLECTED_AT = new Date('2026-09-05T09:00:00.000Z');

function item(source: SourceKind, payload: Record<string, unknown>): CollectedItem {
  return {
    source,
    sourceItemId: 'item-1',
    payload,
    kind: 'post',
    collectedAt: COLLECTED_AT,
  };
}

describe('normalizeXItem', () => {
  const payload = {
    id: '1930000000000001',
    text: 'The new agent framework removes most of the glue code we were writing.',
    created_at: '2026-09-05T08:30:00.000Z',
    lang: 'en',
    author_id: '4471',
    public_metrics: {
      like_count: 412,
      reply_count: 33,
      retweet_count: 88,
      quote_count: 12,
      impression_count: 91_402,
    },
    author: { id: '4471', username: 'agentbuilder', name: 'Agent Builder' },
  };

  it('produces a normalised post', () => {
    const result = normalizeXItem(item('X', payload));
    const post = expectPost(result);

    expect(post.source).toBe('X');
    expect(post.sourcePostId).toBe('1930000000000001');
    expect(post.title).toBeNull();
    expect(post.authorUsername).toBe('agentbuilder');
    expect(post.url).toBe('https://x.com/agentbuilder/status/1930000000000001');
    expect(post.likes).toBe(412);
    // Quotes are a redistribution of the post, so they fold into reposts.
    expect(post.reposts).toBe(100);
    expect(post.views).toBe(91_402);
    expect(post.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('falls back to the canonical status URL without a username', () => {
    const { author, ...withoutAuthor } = payload;
    expect(author).toBeDefined();
    const result = normalizeXItem(item('X', withoutAuthor));
    expect(expectPost(result).url).toBe('https://x.com/i/web/status/1930000000000001');
  });

  it('rejects a payload missing required fields instead of throwing', () => {
    expect(() => normalizeXItem(item('X', { text: 'no id' }))).not.toThrow();
    expect(expectRejection(normalizeXItem(item('X', { text: 'no id' })))).toBeTruthy();
  });

  it('rejects an unparseable timestamp', () => {
    const result = normalizeXItem(item('X', { ...payload, created_at: 'yesterday' }));
    expect(expectRejection(result)).toBeTruthy();
  });
});

describe('normalizeHackerNewsItem', () => {
  const payload = {
    id: 42_000_001,
    type: 'story',
    by: 'pg',
    time: Math.floor(new Date('2026-09-05T07:00:00.000Z').getTime() / 1000),
    title: 'A new agent framework',
    url: 'https://example.test/agents?utm_source=hn',
    score: 284,
    descendants: 91,
  };

  it('stores the submitted article URL, not the discussion page', () => {
    // This is what lets canonical-URL deduplication recognise the same article
    // arriving through Hacker News and through an RSS feed as one story.
    const result = normalizeHackerNewsItem(item('HACKERNEWS', payload));
    expect(expectPost(result).url).toBe('https://example.test/agents?utm_source=hn');
    expect(expectPost(result).canonicalUrl).toBe('https://example.test/agents');
  });

  it('falls back to the item page for a self-post', () => {
    const { url, ...selfPost } = payload;
    expect(url).toBeDefined();
    const result = normalizeHackerNewsItem(
      item('HACKERNEWS', { ...selfPost, text: '<p>Some <b>self</b> text</p>' }),
    );
    expect(expectPost(result).url).toBe('https://news.ycombinator.com/item?id=42000001');
    // HTML must never reach storage as markup.
    expect(expectPost(result).content).not.toContain('<b>');
    expect(expectPost(result).content).toContain('self');
  });

  it('rejects deleted and dead stories', () => {
    expect(
      expectRejection(normalizeHackerNewsItem(item('HACKERNEWS', { ...payload, deleted: true }))),
    ).toBeTruthy();
    expect(
      expectRejection(normalizeHackerNewsItem(item('HACKERNEWS', { ...payload, dead: true }))),
    ).toBeTruthy();
  });

  it('rejects a non-story item type', () => {
    const result = normalizeHackerNewsItem(item('HACKERNEWS', { ...payload, type: 'comment' }));
    expect(expectRejection(result)).toBeTruthy();
  });
});

describe('normalizeRssItem', () => {
  const payload = {
    feedUrl: 'https://example.test/feed.xml',
    feedTitle: 'Example Weekly',
    id: 'entry-1',
    title: 'Agents get a scheduler',
    link: 'https://example.test/posts/agents-scheduler',
    summary: '<p>The release adds a <em>scheduler</em>.</p>',
    author: 'A Writer',
    publishedAt: 'Fri, 05 Sep 2026 06:00:00 GMT',
    categories: ['ai'],
  };

  it('strips markup out of the body', () => {
    const result = normalizeRssItem(item('RSS', payload));
    expect(expectPost(result).content).not.toContain('<em>');
    expect(expectPost(result).content).toContain('scheduler');
  });

  it('reports no engagement rather than inventing it', () => {
    // A feed publishes; it does not measure reaction. Fabricated counts would
    // make RSS look permanently unpopular against sources that really report.
    const result = normalizeRssItem(item('RSS', payload));
    expect(expectPost(result).likes).toBe(0);
    expect(expectPost(result).replies).toBe(0);
    expect(expectPost(result).reposts).toBe(0);
  });

  it('falls back to the collection time for an undated entry', () => {
    const result = normalizeRssItem(item('RSS', { ...payload, publishedAt: null }));
    expect(expectPost(result).publishedAt.getTime()).toBe(COLLECTED_AT.getTime());
  });

  it('rejects an entry with no link', () => {
    expect(
      expectRejection(normalizeRssItem(item('RSS', { ...payload, link: '   ' }))),
    ).toBeTruthy();
  });
});

describe('normalizeGithubItem', () => {
  const repository = {
    kind: 'repository',
    id: 120_000_001,
    full_name: 'agentmesh-labs/portable-memory',
    description: 'Reference implementation for the portable agent memory envelope.',
    html_url: 'https://github.com/agentmesh-labs/portable-memory',
    language: 'TypeScript',
    topics: ['ai-agents', 'memory'],
    stargazers_count: 1_840,
    forks_count: 96,
    open_issues_count: 21,
    pushed_at: '2026-09-05T05:00:00.000Z',
    owner: { login: 'agentmesh-labs' },
  };

  const release = {
    kind: 'release',
    id: 240_000_001,
    repository_full_name: 'agentmesh-labs/portable-memory',
    tag_name: 'v0.4.0',
    name: 'v0.4.0 — lossless tool result round trip',
    body: 'Tool invocations now round trip with their streamed chunks intact.',
    published_at: '2026-09-05T04:00:00.000Z',
    author: { login: 'agentmesh-labs' },
    reactions: { total_count: 74 },
    repository_stars: 1_840,
  };

  it('normalises a repository, folding topics into the searchable text', () => {
    const result = normalizeGithubItem(item('GITHUB', repository));
    expect(expectPost(result).sourcePostId).toBe('repo:120000001');
    expect(expectPost(result).title).toBe('agentmesh-labs/portable-memory');
    expect(expectPost(result).content).toContain('portable agent memory');
    expect(expectPost(result).content).toContain('ai-agents');
    expect(expectPost(result).likes).toBe(1_840);
    expect(expectPost(result).reposts).toBe(96);
    // GitHub reports no view count, so none is invented.
    expect(expectPost(result).views).toBe(0);
  });

  it('normalises a release using its notes as the content', () => {
    const result = normalizeGithubItem(item('GITHUB', release));
    expect(expectPost(result).sourcePostId).toBe('release:240000001');
    expect(expectPost(result).content).toContain('round trip');
    expect(expectPost(result).likes).toBe(74);
  });

  it('rejects a draft release, which is not public', () => {
    const result = normalizeGithubItem(item('GITHUB', { ...release, draft: true }));
    expect(expectRejection(result)).toBeTruthy();
  });

  it('rejects a repository with nothing to score', () => {
    const result = normalizeGithubItem(
      item('GITHUB', { ...repository, description: null, topics: [] }),
    );
    expect(expectRejection(result)).toBeTruthy();
  });

  it('rejects a payload whose kind is unknown', () => {
    expect(
      expectRejection(normalizeGithubItem(item('GITHUB', { kind: 'gist', id: 1 }))),
    ).toBeTruthy();
  });
});

describe('normalizeRedditItem', () => {
  const submission = {
    kind: 'submission',
    id: 'abc123',
    subreddit: 'MachineLearning',
    author: 'researcher',
    title: 'Thoughts on the new agent framework?',
    selftext: 'It removes a lot of glue code but the memory model is surprising.',
    permalink: '/r/MachineLearning/comments/abc123/thoughts/',
    score: 318,
    num_comments: 74,
    created_utc: Math.floor(new Date('2026-09-05T06:30:00.000Z').getTime() / 1000),
  };

  it('produces a normalised post with an absolute URL', () => {
    const result = normalizeRedditItem(item('REDDIT', submission));
    expect(expectPost(result).url).toContain('https://www.reddit.com');
    expect(expectPost(result).title).toBe('Thoughts on the new agent framework?');
    expect(expectPost(result).likes).toBe(318);
  });

  it('rejects a malformed payload without throwing', () => {
    expect(() => normalizeRedditItem(item('REDDIT', { kind: 'submission' }))).not.toThrow();
    expect(
      expectRejection(normalizeRedditItem(item('REDDIT', { kind: 'submission' }))),
    ).toBeTruthy();
  });
});

describe('normalizeItemsForSource', () => {
  it('routes each source to its own normaliser', () => {
    const result = normalizeItemsForSource('X', [
      item('X', {
        id: '1',
        text: 'hello world from the collector',
        created_at: '2026-09-05T08:00:00.000Z',
      }),
    ]);
    expect(result.posts).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('keeps good items when one item in the batch is bad', () => {
    // One malformed item must never cost the whole collection.
    const result = normalizeItemsForSource('X', [
      item('X', {
        id: '1',
        text: 'a usable post about agent frameworks',
        created_at: '2026-09-05T08:00:00.000Z',
      }),
      item('X', { nonsense: true }),
    ]);
    expect(result.posts).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBeTruthy();
  });

  it('returns empty results for an empty batch', () => {
    const result = normalizeItemsForSource('GITHUB', []);
    expect(result.posts).toHaveLength(0);
    expect(result.comments).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});
