import { contentHash, slugify } from '@trendhunter/shared';
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
  FEED_AUTHORS,
  MOCK_FEEDS,
  phraseFor,
  planSlots,
  type MockFeed,
  type MockSlot,
  type Random,
} from '../mock-data';

import { parseFeed } from './parser';

/**
 * Offline RSS adapter.
 *
 * This connector generates feed *documents* and then reads them back through
 * the real parser rather than fabricating parsed entries directly. That costs a
 * few milliseconds and buys a great deal: in development the parser is
 * continuously exercised against CDATA sections, entity-heavy titles, both feed
 * dialects and namespaced elements, so a parsing regression shows up on the
 * dashboard instead of only in a test.
 */
export class RssMockConnector extends BaseConnector {
  readonly source = 'RSS' as const;
  readonly name = 'rss:mock';

  readonly #seed: string;
  readonly #volume: number;

  constructor(options: MockConnectorOptions) {
    super(options);
    this.#seed = options.seed ?? DEFAULT_MOCK_SEED;
    this.#volume = options.volume ?? DEFAULT_MOCK_VOLUME;
  }

  protected collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const random = createRandom(`${this.#seed}:rss`);
    const slots = planSlots({
      random,
      now: context.collectedAt,
      count: Math.round(this.#volume * 0.6),
      tailShare: 0.28,
      arabicShare: 0.14,
    });

    // Each article is assigned to the publication whose beat it belongs to, so
    // a feed reads like a real one rather than like a random sample.
    const byFeed = new Map<string, MockSlot[]>();
    for (const slot of slots) {
      const feed = this.#feedFor(random, slot);
      const bucket = byFeed.get(feed.id);
      if (bucket) bucket.push(slot);
      else byFeed.set(feed.id, [slot]);
    }

    const items: CollectedItem[] = [];
    for (const feed of MOCK_FEEDS) {
      const assigned = byFeed.get(feed.id) ?? [];
      if (assigned.length === 0) continue;

      const document =
        feed.format === 'atom'
          ? renderAtomFeed(feed, assigned, random)
          : renderRssFeed(feed, assigned, random);
      const parsed = parseFeed(document);

      for (const entry of parsed.items) {
        if (context.isSatisfied(items.length)) break;
        const publishedAt = entry.publishedAt === null ? null : new Date(entry.publishedAt);
        if (context.since && publishedAt && publishedAt < context.since) continue;

        items.push(
          this.item(context, {
            sourceItemId: feedItemId(feed.feedUrl, entry.id),
            kind: 'post',
            payload: {
              feedUrl: feed.feedUrl,
              feedTitle: parsed.title,
              id: entry.id,
              title: entry.title,
              link: entry.link,
              summary: entry.summary,
              content: entry.content,
              author: entry.author,
              publishedAt: entry.publishedAt,
              categories: entry.categories,
            },
          }),
        );
      }
    }

    // Feeds were rendered one publication at a time; the caller expects the
    // combined result in the same recency order every other source uses.
    items.sort(
      (a, b) => publishedTime(b.payload.publishedAt) - publishedTime(a.payload.publishedAt),
    );
    return Promise.resolve(items);
  }

  #feedFor(random: Random, slot: MockSlot): MockFeed {
    const category = slot.topic?.category ?? slot.tail?.category;
    const matching = MOCK_FEEDS.filter(
      (feed) => category !== undefined && feed.categories.includes(category),
    );
    return matching.length > 0 ? random.pick(matching) : random.pick(MOCK_FEEDS);
  }
}

/** Stable identity for an entry: a feed's guids are only unique within it. */
export function feedItemId(feedUrl: string, entryId: string): string {
  return contentHash(feedUrl, entryId).slice(0, 32);
}

function publishedTime(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function renderRssFeed(feed: MockFeed, slots: readonly MockSlot[], random: Random): string {
  const entries = slots
    .map((slot) => {
      const article = articleFor(slot, random);
      // Half the descriptions are wrapped in CDATA and half are entity-escaped,
      // because both appear in the wild and only one of them is easy.
      const description = random.bool(0.5)
        ? `<![CDATA[${article.html}]]>`
        : escapeXml(article.html);
      return [
        '    <item>',
        `      <title>${escapeXml(article.title)}</title>`,
        `      <link>${escapeXml(article.link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(article.guid)}</guid>`,
        `      <pubDate>${slot.publishedAt.toUTCString()}</pubDate>`,
        `      <dc:creator>${escapeXml(article.author)}</dc:creator>`,
        `      <description>${description}</description>`,
        `      <content:encoded><![CDATA[${article.html}${article.extraHtml}]]></content:encoded>`,
        ...article.categories.map(
          (category) => `      <category>${escapeXml(category)}</category>`,
        ),
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${escapeXml(feed.title)}</title>`,
    `    <link>${escapeXml(feed.siteUrl)}</link>`,
    '    <description>Original synthetic corpus for local development.</description>',
    entries,
    '  </channel>',
    '</rss>',
  ].join('\n');
}

function renderAtomFeed(feed: MockFeed, slots: readonly MockSlot[], random: Random): string {
  const entries = slots
    .map((slot) => {
      const article = articleFor(slot, random);
      return [
        '  <entry>',
        `    <title type="text">${escapeXml(article.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(article.link)}"/>`,
        `    <link rel="self" href="${escapeXml(feed.feedUrl)}"/>`,
        `    <id>${escapeXml(article.guid)}</id>`,
        `    <published>${slot.publishedAt.toISOString()}</published>`,
        `    <updated>${slot.publishedAt.toISOString()}</updated>`,
        `    <author><name>${escapeXml(article.author)}</name></author>`,
        `    <summary type="html">${escapeXml(article.html)}</summary>`,
        `    <content type="html"><![CDATA[${article.html}${article.extraHtml}]]></content>`,
        ...article.categories.map((category) => `    <category term="${escapeXml(category)}"/>`),
        '  </entry>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(feed.title)}</title>`,
    `  <link rel="alternate" href="${escapeXml(feed.siteUrl)}"/>`,
    `  <id>${escapeXml(feed.siteUrl)}/</id>`,
    entries,
    '</feed>',
  ].join('\n');
}

interface MockArticle {
  readonly title: string;
  readonly link: string;
  readonly guid: string;
  readonly author: string;
  readonly html: string;
  readonly extraHtml: string;
  readonly categories: readonly string[];
}

function articleFor(slot: MockSlot, random: Random): MockArticle {
  const topic = slot.topic;
  const title = topic ? phraseFor(random, slot, topic.headlines.rss) : (slot.tail?.title ?? '');
  const body = topic ? random.pick(topic.bodies) : (slot.tail?.body ?? '');
  const domain = topic?.linkDomain ?? 'signal-and-stack.example.com';
  const slug = slugify(title, 70);

  // The ordinal is part of the identity, not decoration. A seed offers only a
  // handful of headlines, so two slots on the same story regularly choose the
  // same wording; without it they would share a guid, and the (source,
  // sourceItemId) unique constraint would silently drop the second one during
  // ingestion. Real feeds never reuse a guid either.
  const ordinal = String(slot.ordinal);

  return {
    title,
    link: `https://${domain}/${slug}-${ordinal}`,
    guid: `tag:${domain},2026:${slug}-${ordinal}`,
    author: random.pick(FEED_AUTHORS),
    html: `<p>${body}</p>`,
    extraHtml: `<p>Filed under ${topic?.category ?? slot.tail?.category ?? 'general'}.</p>`,
    categories: topic ? topic.keywords.slice(0, 3) : [slot.tail?.category ?? 'general'],
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
