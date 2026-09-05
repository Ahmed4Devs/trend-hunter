import { slugify } from '@trendhunter/shared';
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
  HACKERNEWS_AUTHORS,
  phraseFor,
  planSlots,
  type MockSlot,
  type Random,
} from '../mock-data';

/**
 * Offline Hacker News adapter.
 *
 * Hacker News titles are terse and declarative, which makes this the source
 * whose phrasing diverges most from the same story on X or in a feed — exactly
 * the case cross-source clustering has to handle. A minority of stories are
 * self-posts with HTML bodies, so the normaliser's `stripHtml` path is
 * exercised in development rather than only in tests.
 */
export class HackerNewsMockConnector extends BaseConnector {
  readonly source = 'HACKERNEWS' as const;
  readonly name = 'hackernews:mock';

  readonly #seed: string;
  readonly #volume: number;

  constructor(options: MockConnectorOptions) {
    super(options);
    this.#seed = options.seed ?? DEFAULT_MOCK_SEED;
    this.#volume = options.volume ?? DEFAULT_MOCK_VOLUME;
  }

  protected collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const random = createRandom(`${this.#seed}:hackernews`);
    const slots = planSlots({
      random,
      now: context.collectedAt,
      count: Math.round(this.#volume * 0.7),
      tailShare: 0.35,
      // Hacker News is overwhelmingly English; a token Arabic share here would
      // misrepresent the source and skew the Arabic opportunity signal.
      arabicShare: 0,
    });

    const items: CollectedItem[] = [];
    for (const slot of slots) {
      if (context.since && slot.publishedAt < context.since) continue;
      if (context.isSatisfied(items.length)) break;
      items.push(this.#buildItem(context, random, slot));
    }
    return Promise.resolve(items);
  }

  #buildItem(context: CollectionContext, random: Random, slot: MockSlot): CollectedItem {
    const id = 42_000_000 + slot.ordinal * 137;
    const title = slot.topic
      ? phraseFor(random, slot, slot.topic.headlines.hackernews)
      : (slot.tail?.title ?? '');
    const score = engagementFor(random, slot, { base: 1, ceiling: 1_400, exponent: 1.7 });
    const isSelfPost = random.bool(0.22);

    const article = slot.topic
      ? `https://${slot.topic.linkDomain}/${slot.topic.slug}`
      : `https://signal-and-stack.example.com/notes/${slugify(title, 60)}`;

    return this.item(context, {
      sourceItemId: String(id),
      kind: 'post',
      payload: {
        id,
        type: 'story',
        by: random.pick(HACKERNEWS_AUTHORS),
        time: Math.floor(slot.publishedAt.getTime() / 1000),
        title: isSelfPost ? `Ask HN: ${lowerFirst(title)}` : title,
        ...(isSelfPost
          ? { text: `<p>${escapeHtml(this.#body(random, slot))}</p>` }
          : { url: article }),
        score,
        descendants: Math.round(score * (0.15 + random.next() * 0.6)),
      },
    });
  }

  #body(random: Random, slot: MockSlot): string {
    if (slot.topic) return random.pick(slot.topic.bodies);
    return slot.tail?.body ?? '';
  }
}

function lowerFirst(value: string): string {
  const [first, ...rest] = value;
  return first === undefined ? value : `${first.toLowerCase()}${rest.join('')}`;
}

/** Self-post bodies arrive as HTML; the mock has to look the same or it proves nothing. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
