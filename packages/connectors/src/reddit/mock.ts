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
  base36Id,
  createRandom,
  engagementFor,
  phraseFor,
  planSlots,
  REDDIT_AUTHORS,
  REDDIT_SUBREDDITS,
  type MockSlot,
  type Random,
} from '../mock-data';

/**
 * Offline Reddit adapter.
 *
 * Reddit is the only mock source that emits comments, and they are generated
 * with real substance rather than filler: a comment thread is where a topic's
 * actual problems appear, and the clustering and content layers downstream are
 * meant to mine exactly that. Each submission gets between zero and a handful,
 * so the "post with no discussion" case is present too.
 */
export class RedditMockConnector extends BaseConnector {
  readonly source = 'REDDIT' as const;
  readonly name = 'reddit:mock';

  readonly #seed: string;
  readonly #volume: number;

  constructor(options: MockConnectorOptions) {
    super(options);
    this.#seed = options.seed ?? DEFAULT_MOCK_SEED;
    this.#volume = options.volume ?? DEFAULT_MOCK_VOLUME;
  }

  protected collectItems(context: CollectionContext): Promise<readonly CollectedItem[]> {
    const random = createRandom(`${this.#seed}:reddit`);
    // Two thirds of the budget goes to submissions; the rest leaves room for
    // the comments each one drags in, so the limit is not spent on posts alone.
    const submissionCount = Math.max(1, Math.round(this.#volume * 0.6));
    const slots = planSlots({
      random,
      now: context.collectedAt,
      count: submissionCount,
      tailShare: 0.32,
      arabicShare: 0.1,
    });

    const items: CollectedItem[] = [];
    for (const slot of slots) {
      if (context.since && slot.publishedAt < context.since) continue;
      if (context.isSatisfied(items.length)) break;

      const submission = this.#buildSubmission(context, random, slot);
      items.push(submission.item);

      for (const comment of this.#buildComments(context, random, slot, submission)) {
        if (context.isSatisfied(items.length)) break;
        items.push(comment);
      }
    }
    return Promise.resolve(items);
  }

  #buildSubmission(
    context: CollectionContext,
    random: Random,
    slot: MockSlot,
  ): { item: CollectedItem; fullname: string; subreddit: string; commentCount: number } {
    const id = base36Id(slot.ordinal);
    const fullname = `t3_${id}`;
    const subreddit = this.#subredditFor(random, slot);
    const author = random.pick(REDDIT_AUTHORS);
    const title = slot.topic
      ? phraseFor(random, slot, slot.topic.headlines.reddit)
      : (slot.tail?.title ?? '');
    const selftext = slot.topic ? random.pick(slot.topic.bodies) : (slot.tail?.body ?? '');

    const score = engagementFor(random, slot, { base: 1, ceiling: 6_500, exponent: 1.6 });
    const commentCount = Math.round(score * (0.05 + random.next() * 0.35));

    return {
      fullname,
      subreddit,
      commentCount,
      item: this.item(context, {
        sourceItemId: fullname,
        kind: 'post',
        payload: {
          id,
          name: fullname,
          subreddit,
          title,
          selftext,
          author,
          permalink: `/r/${subreddit}/comments/${id}/${slugify(title, 60)}/`,
          url: `https://www.reddit.com/r/${subreddit}/comments/${id}/${slugify(title, 60)}/`,
          created_utc: Math.floor(slot.publishedAt.getTime() / 1000),
          score,
          ups: score,
          num_comments: commentCount,
          upvote_ratio: Math.round((0.6 + random.next() * 0.39) * 100) / 100,
          over_18: false,
          stickied: false,
          is_self: true,
        },
      }),
    };
  }

  #buildComments(
    context: CollectionContext,
    random: Random,
    slot: MockSlot,
    submission: { fullname: string; subreddit: string; commentCount: number },
  ): CollectedItem[] {
    const pool = slot.topic?.comments ?? [];
    if (pool.length === 0) return [];

    const comments: CollectedItem[] = [];
    const wanted = Math.min(pool.length, Math.min(submission.commentCount, random.int(0, 5)));
    for (let index = 0; index < wanted; index += 1) {
      const commentId = base36Id(slot.ordinal * 11 + index + 1, 91_000_000);
      const fullname = `t1_${commentId}`;
      // Comments trail their submission and never overtake the collection
      // instant; a reply timestamped after "now" would corrupt every recency
      // signal derived from the thread.
      const publishedAt = new Date(
        Math.min(
          context.collectedAt.getTime() - 60_000,
          slot.publishedAt.getTime() + random.int(4, 900) * 60_000 * (index + 1),
        ),
      );

      comments.push(
        this.item(context, {
          sourceItemId: fullname,
          kind: 'comment',
          parentSourceItemId: submission.fullname,
          payload: {
            id: commentId,
            name: fullname,
            link_id: submission.fullname,
            parent_id: submission.fullname,
            subreddit: submission.subreddit,
            body: pool[index] ?? '',
            author: random.pick(REDDIT_AUTHORS),
            permalink: `/r/${submission.subreddit}/comments/${submission.fullname.slice(3)}/_/${commentId}/`,
            created_utc: Math.floor(publishedAt.getTime() / 1000),
            score: engagementFor(random, slot, { base: 1, ceiling: 900, exponent: 1.8 }),
            depth: 0,
          },
        }),
      );
    }
    return comments;
  }

  /** Routes a slot to a plausible subreddit so the corpus is not uniformly spread. */
  #subredditFor(random: Random, slot: MockSlot): string {
    const category = slot.topic?.category ?? slot.tail?.category;
    switch (category) {
      case 'ai':
        return random.pick(['artificial', 'ExperiencedDevs', 'SaaS']);
      case 'saas':
        return random.pick(['SaaS', 'startups']);
      case 'automation':
      case 'apis':
        return random.pick(['devops', 'ExperiencedDevs']);
      case 'sales':
        return random.pick(['sales', 'SaaS']);
      case 'startups':
      case 'gulf':
        return random.pick(['startups', 'SaaS']);
      // A slot with neither a topic nor a tail category is background chatter.
      case undefined:
      default:
        return random.pick(REDDIT_SUBREDDITS);
    }
  }
}
