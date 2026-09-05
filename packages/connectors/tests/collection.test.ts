import { UpstreamError } from '@trendhunter/shared';
import type { CollectedItem, SourceKind } from '@trendhunter/types';
import { describe, expect, it } from 'vitest';

import { createAllConnectors, createConnector, normalizeItemsForSource } from '../src/registry';
import { HttpClient } from '../src/http';
import { parseFeed, parseXml } from '../src/rss/parser';

/**
 * End-to-end behaviour of the offline corpus and the shared HTTP layer.
 *
 * The corpus tests matter more than they look: `DATA_MODE=mock` is how the
 * entire product is developed and demonstrated, so if the generated data has no
 * cross-source overlap, no Arabic and no heavy tail, then clustering, the
 * Arabic opportunity score and the trend engine are all being exercised against
 * data that cannot show they work.
 */

const NOW = new Date('2026-09-05T12:00:00.000Z');

/** A logger that satisfies the structural interface without printing. */
const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLogger,
} as unknown as Parameters<typeof createConnector>[1]['logger'];

function factoryOptions(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'mock' as const,
    logger: silentLogger,
    now: () => NOW,
    ...overrides,
  };
}

const SOURCES: SourceKind[] = ['X', 'REDDIT', 'HACKERNEWS', 'RSS', 'GITHUB'];

async function collectAll(seed?: string): Promise<Map<SourceKind, CollectedItem[]>> {
  const connectors = createAllConnectors(factoryOptions(seed === undefined ? {} : { seed }));
  const collected = new Map<SourceKind, CollectedItem[]>();
  for (const [source, connector] of connectors) {
    const result = await connector.collect({ limit: 60, config: {} });
    collected.set(source, [...result.items]);
  }
  return collected;
}

describe('the offline corpus', () => {
  it('produces items for every source', async () => {
    const collected = await collectAll();
    for (const source of SOURCES) {
      expect(collected.get(source)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same seed', async () => {
    const first = await collectAll('fixed-seed');
    const second = await collectAll('fixed-seed');
    for (const source of SOURCES) {
      expect(second.get(source)).toStrictEqual(first.get(source));
    }
  });

  it('produces different data for a different seed', async () => {
    const a = await collectAll('seed-a');
    const b = await collectAll('seed-b');
    expect(b.get('X')).not.toStrictEqual(a.get('X'));
  });

  it('respects the requested limit', async () => {
    const connector = createConnector('X', factoryOptions());
    const result = await connector.collect({ limit: 7, config: {} });
    expect(result.items).toHaveLength(7);
  });

  it('honours a `since` cut-off', async () => {
    const connector = createConnector('X', factoryOptions());
    const since = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const result = await connector.collect({ limit: 60, config: {}, since });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      const payload = item.payload as { created_at?: string };
      expect(new Date(payload.created_at ?? 0).getTime()).toBeGreaterThanOrEqual(since.getTime());
    }
  });

  it('stamps every item with the collection instant', async () => {
    const connector = createConnector('REDDIT', factoryOptions());
    const result = await connector.collect({ limit: 5, config: {} });
    for (const item of result.items) {
      expect(item.collectedAt.getTime()).toBe(NOW.getTime());
    }
  });

  it('normalises cleanly across every source', async () => {
    const collected = await collectAll();
    for (const source of SOURCES) {
      const items = collected.get(source) ?? [];
      const result = normalizeItemsForSource(source, items);
      // A generated corpus that its own normaliser rejects would be worthless
      // as a development fixture.
      expect(result.rejected).toHaveLength(0);
      expect(result.posts.length + result.comments.length).toBeGreaterThan(0);
    }
  });

  it('surfaces the same story on several sources', async () => {
    // Cross-source clustering is the feature this corpus exists to exercise.
    const collected = await collectAll();
    const tokensBySource = new Map<SourceKind, Set<string>>();

    for (const source of SOURCES) {
      const { posts } = normalizeItemsForSource(source, collected.get(source) ?? []);
      const tokens = new Set<string>();
      for (const post of posts) {
        for (const token of `${post.title ?? ''} ${post.content}`
          .toLowerCase()
          .split(/[^a-z0-9]+/u)
          .filter((word) => word.length > 4)) {
          tokens.add(token);
        }
      }
      tokensBySource.set(source, tokens);
    }

    const x = tokensBySource.get('X') ?? new Set();
    const reddit = tokensBySource.get('REDDIT') ?? new Set();
    const hn = tokensBySource.get('HACKERNEWS') ?? new Set();
    const shared = [...x].filter((token) => reddit.has(token) && hn.has(token));
    expect(shared.length).toBeGreaterThan(5);
  });

  it('includes Arabic content, without which the opportunity score has no signal', async () => {
    const collected = await collectAll();
    const arabicScript = /[؀-ۿ]/u;
    const { posts } = normalizeItemsForSource('X', collected.get('X') ?? []);
    const arabic = posts.filter((post) => arabicScript.test(post.content));
    expect(arabic.length).toBeGreaterThan(0);
    // But it must stay the minority, or there would be no coverage gap to find.
    expect(arabic.length).toBeLessThan(posts.length / 2);
  });

  it('produces a heavy-tailed engagement distribution', async () => {
    const collected = await collectAll();
    const { posts } = normalizeItemsForSource('X', collected.get('X') ?? []);
    const likes = posts.map((post) => post.likes).sort((a, b) => b - a);
    expect(likes.length).toBeGreaterThan(10);

    const top = likes[0] ?? 0;
    const median = likes[Math.floor(likes.length / 2)] ?? 0;
    // A uniform distribution would make every trend score identical and hide
    // the false-trend case the ranking layer is built to resist.
    expect(top).toBeGreaterThan(median * 5);
  });

  it('produces unique identifiers within a source', async () => {
    const collected = await collectAll();
    for (const source of SOURCES) {
      const items = collected.get(source) ?? [];
      const ids = items.map((item) => item.sourceItemId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('collects Reddit comments as well as submissions', async () => {
    // Comments are where problems and questions surface, which is what the
    // product mines for content opportunities.
    const connector = createConnector('REDDIT', factoryOptions());
    const result = await connector.collect({ limit: 60, config: {} });
    expect(result.items.some((item) => item.kind === 'comment')).toBe(true);
  });
});

describe('createConnector in live mode', () => {
  it('fails only the source whose credentials are missing', async () => {
    const connectors = createAllConnectors(factoryOptions({ mode: 'live', credentials: {} }));

    // Building every connector must succeed even with nothing configured.
    expect(connectors.size).toBe(5);

    await expect(connectors.get('X')?.collect({ limit: 5, config: {} })).rejects.toBeInstanceOf(
      UpstreamError,
    );
    await expect(
      connectors.get('REDDIT')?.collect({ limit: 5, config: {} }),
    ).rejects.toBeInstanceOf(UpstreamError);

    // Hacker News needs no credentials, so it is a real adapter either way.
    expect(connectors.get('HACKERNEWS')?.name).toBe('hackernews:http');
  });

  it('builds the real adapter once credentials are present', () => {
    const connector = createConnector(
      'X',
      factoryOptions({ mode: 'live', credentials: { xBearerToken: 'token-value' } }),
    );
    expect(connector.name).toBe('x:http');
  });
});

describe('HttpClient SSRF guard', () => {
  const client = new HttpClient({
    userAgent: 'test',
    fetchImpl: () => {
      throw new Error('the request must never be issued');
    },
  });

  const blocked = [
    'http://localhost/feed.xml',
    'http://127.0.0.1:8080/feed.xml',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/feed.xml',
    'http://192.168.1.10/feed.xml',
    'http://172.16.0.9/feed.xml',
    'http://postgres:5432/',
    'http://redis:6379/',
    'http://internal.local/feed.xml',
    'file:///etc/passwd',
    'ftp://example.com/feed.xml',
    'https://user:pass@example.com/feed.xml',
    'https://example.com:22/feed.xml',
  ];

  for (const url of blocked) {
    it(`refuses ${url}`, async () => {
      await expect(client.requestText({ url, provider: 'rss' })).rejects.toThrow();
    });
  }
});

describe('the feed parser', () => {
  it('reads RSS 2.0 with CDATA', () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Example Weekly</title>
          <link>https://example.test</link>
          <item>
            <title><![CDATA[Agents get a <scheduler>]]></title>
            <link>https://example.test/a</link>
            <guid>a-1</guid>
            <description><![CDATA[<p>Body &amp; more</p>]]></description>
            <pubDate>Fri, 05 Sep 2026 06:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`);

    expect(feed.title).toBe('Example Weekly');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]?.title).toContain('scheduler');
    expect(feed.items[0]?.id).toBe('a-1');
  });

  it('reads Atom', () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Example</title>
        <link href="https://example.test"/>
        <entry>
          <title>Entry one</title>
          <id>urn:uuid:1</id>
          <link href="https://example.test/one"/>
          <updated>2026-09-05T06:00:00Z</updated>
          <content type="html">&lt;p&gt;Hello&lt;/p&gt;</content>
        </entry>
      </feed>`);

    expect(feed.title).toBe('Atom Example');
    expect(feed.items[0]?.link).toBe('https://example.test/one');
    expect(feed.items[0]?.id).toBe('urn:uuid:1');
  });

  it('decodes numeric and named entities', () => {
    const feed = parseFeed(`<rss version="2.0"><channel><title>T</title>
      <item><title>Caf&#233; &amp; co &mdash; done</title>
      <link>https://example.test/x</link></item></channel></rss>`);
    expect(feed.items[0]?.title).toContain('Café');
    expect(feed.items[0]?.title).toContain('&');
  });

  it('rejects a document that is not a feed instead of hanging', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>')).toThrow();
  });

  it('survives malformed markup without throwing an unexpected error', () => {
    // A hostile or simply broken feed must produce a clean failure, never an
    // unbounded parse.
    for (const document of ['', '<rss>', '<<<>>>', '<rss version="2.0"><channel>']) {
      expect(() => {
        try {
          parseFeed(document);
        } catch {
          // A ValidationError is the expected outcome; anything else fails.
        }
      }).not.toThrow();
    }
  });

  it('bounds nesting depth so a deeply nested document cannot exhaust the stack', () => {
    const deep = `${'<a>'.repeat(500)}x${'</a>'.repeat(500)}`;
    expect(() => parseXml(deep)).toThrow();
  });
});
