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
  numericId,
  phraseFor,
  planSlots,
  X_AUTHORS,
  type MockSlot,
  type Random,
} from '../mock-data';

/**
 * Offline X adapter.
 *
 * Posts are short, opinionated and unattributed to a title, which is what makes
 * X the source that most needs a heavy-tailed engagement distribution: a single
 * large account restating a story is the classic false trend signal, and the
 * ranking layer only has something to defend against if the corpus contains it.
 */
export class XMockConnector extends BaseConnector {
  readonly source = 'X' as const;
  readonly name = 'x:mock';

  readonly #seed: string;
  readonly #volume: number;

  constructor(options: MockConnectorOptions) {
    super(options);
    this.#seed = options.seed ?? DEFAULT_MOCK_SEED;
    this.#volume = options.volume ?? DEFAULT_MOCK_VOLUME;
  }

  protected collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const random = createRandom(`${this.#seed}:x`);
    const slots = planSlots({
      random,
      now: context.collectedAt,
      count: this.#volume,
      tailShare: 0.3,
      // X is where the Arabic technical conversation actually happens, so it
      // carries the largest Arabic share of the five sources.
      arabicShare: 0.22,
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
    const author = random.pick(X_AUTHORS);
    const id = numericId('19', slot.ordinal);
    const text = this.#composeText(random, slot);

    // Reach shifts the whole distribution rather than multiplying the draw, so
    // a small account occasionally out-performs a large one, as they do.
    const reachFactor = 0.4 + Math.log10(author.reach) / 6;
    const likes = Math.round(
      engagementFor(random, slot, { base: 2, ceiling: 24_000 }) * reachFactor,
    );

    return this.item(context, {
      sourceItemId: id,
      kind: 'post',
      payload: {
        id,
        text,
        created_at: slot.publishedAt.toISOString(),
        lang: slot.language,
        author_id: author.id,
        conversation_id: id,
        public_metrics: {
          like_count: likes,
          reply_count: Math.round(likes * (0.05 + random.next() * 0.2)),
          retweet_count: Math.round(likes * (0.1 + random.next() * 0.3)),
          quote_count: Math.round(likes * random.next() * 0.06),
          impression_count: Math.round(likes * (18 + random.next() * 90)) + random.int(80, 900),
        },
        author: { id: author.id, username: author.username, name: author.name },
      },
    });
  }

  /**
   * Composes the post text.
   *
   * A minority of posts carry a link and a hashtag. Both are deliberate: the
   * content hash strips URLs, so a corpus without them would never exercise
   * that, and hashtags are the kind of trailing noise that breaks naive
   * tokenisation.
   */
  #composeText(random: Random, slot: MockSlot): string {
    const tail = slot.tail;
    const base = tail
      ? random.bool(0.55)
        ? tail.title
        : tail.body
      : phraseFor(random, slot, slot.topic?.headlines.x ?? []);

    const parts = [base.trim()];
    if (slot.topic && random.bool(0.28)) {
      parts.push(`https://${slot.topic.linkDomain}/${slot.topic.slug}`);
    }
    if (slot.topic && random.bool(0.2)) {
      const keyword = random.pick(slot.topic.keywords).replace(/[^\p{L}\p{N}]+/gu, '');
      if (keyword.length > 2) parts.push(`#${keyword}`);
    }
    return parts.join(' ');
  }
}
