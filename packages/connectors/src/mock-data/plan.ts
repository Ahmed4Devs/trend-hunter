import { MILLISECONDS_PER_HOUR } from '@trendhunter/shared';

import type { Random } from './random';
import { TAIL_ITEMS } from './tail';
import { TOPIC_SEEDS } from './topics';
import type { MockMomentum, TailItem, TopicSeed } from './types';

/**
 * Turns the corpus into a timed, weighted schedule of items for one source.
 *
 * The scheduler is where the corpus stops being a list of strings and starts
 * behaving like collected data: volume follows topic weight, timestamps follow
 * momentum, and engagement follows a heavy tail. Each source generator then
 * decides only how to *phrase* a slot, which is what keeps the same event
 * recognisably itself across five providers.
 */

export interface MockSlot {
  /** The event this slot belongs to, or `null` for background chatter. */
  readonly topic: TopicSeed | null;
  readonly tail: TailItem | null;
  readonly publishedAt: Date;
  /**
   * 0..1 draw controlling how much attention this item gets. Kept separate
   * from the timestamp so a fresh item is not automatically a popular one.
   */
  readonly heat: number;
  readonly language: 'en' | 'ar';
  /** Stable ordinal within the source, used to build provider identifiers. */
  readonly ordinal: number;
}

export interface PlanOptions {
  readonly random: Random;
  readonly now: Date;
  /** Total slots to schedule. */
  readonly count: number;
  /** Share of slots devoted to background chatter, 0..1. */
  readonly tailShare: number;
  /** Probability that a topic slot is published in Arabic, when a phrasing exists. */
  readonly arabicShare: number;
  /** Only seeds matching this predicate are scheduled; used by GitHub. */
  readonly topicFilter?: (topic: TopicSeed) => boolean;
}

/**
 * How posting activity is distributed between the moment a story broke and now.
 *
 * The exponent shapes the draw: below one it pushes items towards the break
 * (a conversation that has already peaked), above one towards the present (a
 * conversation still accelerating). The trend engine reads velocity from
 * exactly this, so a single profile would make every topic score alike.
 */
const AGE_EXPONENT: Readonly<Record<MockMomentum, number>> = {
  breaking: 2.2,
  rising: 1.4,
  steady: 1,
  fading: 0.5,
};

/** Multiplies a seed's weight, so a breaking story really does dominate volume. */
const MOMENTUM_VOLUME: Readonly<Record<MockMomentum, number>> = {
  breaking: 1.5,
  rising: 1.25,
  steady: 1,
  fading: 0.6,
};

/** Background chatter is spread across the last week rather than around an event. */
const TAIL_WINDOW_HOURS = 168;

export function planSlots(options: PlanOptions): MockSlot[] {
  const { random, now, count } = options;
  const topics = TOPIC_SEEDS.filter((topic) => options.topicFilter?.(topic) ?? true);
  if (topics.length === 0 || count <= 0) return [];

  const tailCount = Math.min(count, Math.round(count * clampShare(options.tailShare)));
  const topicCount = count - tailCount;

  const slots: MockSlot[] = [];
  for (const [topic, share] of allocate(topics, topicCount)) {
    for (let i = 0; i < share; i += 1) {
      slots.push(topicSlot(topic, random, now, options.arabicShare, slots.length));
    }
  }
  for (let i = 0; i < tailCount; i += 1) {
    slots.push(tailSlot(random, now, slots.length));
  }

  // Providers hand back their most recent items first; ordering matters because
  // a bounded `limit` must cut the oldest items, not an arbitrary subset.
  return slots.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

/**
 * Distributes `total` slots across seeds in proportion to weight and momentum.
 *
 * The largest-remainder method is used rather than rounding each share, because
 * rounding loses or invents items and the caller asked for an exact count.
 */
function allocate(topics: readonly TopicSeed[], total: number): [TopicSeed, number][] {
  if (total <= 0) return [];
  const weights = topics.map((topic) => topic.weight * MOMENTUM_VOLUME[topic.momentum]);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return [];

  const exact = topics.map((_topic, index) => ((weights[index] ?? 0) / weightTotal) * total);
  const floors = exact.map((value) => Math.floor(value));
  let assigned = floors.reduce((sum, value) => sum + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const entry of byRemainder) {
    if (assigned >= total) break;
    floors[entry.index] = (floors[entry.index] ?? 0) + 1;
    assigned += 1;
  }

  return topics.map((topic, index) => [topic, floors[index] ?? 0]);
}

function topicSlot(
  topic: TopicSeed,
  random: Random,
  now: Date,
  arabicShare: number,
  ordinal: number,
): MockSlot {
  const fraction = Math.pow(random.next(), AGE_EXPONENT[topic.momentum]);
  // A minute of jitter keeps two items from sharing a timestamp, which would
  // make ordering depend on sort stability rather than on the data.
  const ageHours = topic.brokeHoursAgo * fraction + random.next() / 60;
  const speaksArabic = topic.arabic.length > 0 && random.bool(clampShare(arabicShare));

  return {
    topic,
    tail: null,
    publishedAt: new Date(now.getTime() - ageHours * MILLISECONDS_PER_HOUR),
    heat: random.next(),
    language: speaksArabic ? 'ar' : 'en',
    ordinal,
  };
}

function tailSlot(random: Random, now: Date, ordinal: number): MockSlot {
  const tail = random.pick(TAIL_ITEMS);
  const ageHours = random.next() * TAIL_WINDOW_HOURS;
  return {
    topic: null,
    tail,
    publishedAt: new Date(now.getTime() - ageHours * MILLISECONDS_PER_HOUR),
    heat: random.next() * 0.7,
    language: tail.language,
    ordinal,
  };
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Draws an engagement counter for a slot.
 *
 * `heat` shifts the whole distribution rather than replacing it, so a popular
 * item is usually — but not always — the one with the biggest numbers. That
 * residual noise is what stops engagement and recency from being collinear,
 * which would make every ranking test pass for the wrong reason.
 */
export function engagementFor(
  random: Random,
  slot: MockSlot,
  options: { readonly base: number; readonly ceiling: number; readonly exponent?: number },
): number {
  const drawn = random.powerLaw(options.base, options.ceiling, options.exponent ?? 1.4);
  const scaled = drawn * (0.35 + slot.heat * 1.3);
  return Math.max(0, Math.round(scaled));
}

/**
 * A provider-shaped numeric identifier.
 *
 * X snowflakes are seventeen digits and exceed the safe integer range, so the
 * high part is a string prefix and only the low part is arithmetic.
 */
export function numericId(prefix: string, ordinal: number, stride = 6173): string {
  return `${prefix}${String(700_000_000_000 + ordinal * stride)}`;
}

/** Reddit-style base 36 identifier. */
export function base36Id(ordinal: number, offset = 61_000_000): string {
  return (offset + ordinal * 7919).toString(36);
}

/** The text of a slot in its scheduled language, given the English alternatives. */
export function phraseFor(
  random: Random,
  slot: MockSlot,
  englishOptions: readonly string[],
): string {
  if (slot.language === 'ar' && slot.topic && slot.topic.arabic.length > 0) {
    return random.pick(slot.topic.arabic);
  }
  if (slot.tail) return slot.tail.title;
  const first = englishOptions[0];
  return first === undefined ? '' : random.pick(englishOptions);
}
