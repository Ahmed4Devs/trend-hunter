/**
 * Shapes of the synthetic corpus.
 *
 * A seed is one *event* rather than one item: the same event is phrased
 * differently on every source, which is exactly what cross-source clustering
 * has to survive. Everything is written specifically for this repository — no
 * text is copied from a real article, feed or account.
 */

export const MOCK_CATEGORIES = [
  'ai',
  'saas',
  'automation',
  'apis',
  'startups',
  'sales',
  'gulf',
] as const;
export type MockCategory = (typeof MOCK_CATEGORIES)[number];

/**
 * How the conversation about a seed is distributed in time. The trend engine
 * reads velocity from exactly this shape, so a corpus with only one profile
 * would make every topic score identically.
 */
export const MOCK_MOMENTUMS = ['breaking', 'rising', 'steady', 'fading'] as const;
export type MockMomentum = (typeof MOCK_MOMENTUMS)[number];

/** Per-source phrasings of one event. Deliberately not paraphrases of a single template. */
export interface TopicHeadlines {
  readonly x: readonly string[];
  readonly reddit: readonly string[];
  readonly hackernews: readonly string[];
  readonly rss: readonly string[];
}

export interface MockRepository {
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly language: string;
  readonly topics: readonly string[];
  readonly releaseTag: string;
  readonly releaseTitle: string;
  readonly releaseNotes: string;
}

export interface TopicSeed {
  readonly id: string;
  readonly slug: string;
  readonly category: MockCategory;
  /** Terms a relevance profile can match on; also used to build repo topics and tags. */
  readonly keywords: readonly string[];
  /** Hours before `now` at which the story broke. */
  readonly brokeHoursAgo: number;
  readonly momentum: MockMomentum;
  /** Relative share of generated volume; the values need not sum to anything. */
  readonly weight: number;
  readonly headlines: TopicHeadlines;
  /** Longer prose used for Reddit self-text and feed article bodies. */
  readonly bodies: readonly string[];
  /** Reddit comment texts — where the problems and the questions actually surface. */
  readonly comments: readonly string[];
  /** Arabic phrasings of the same event, for the Arabic opportunity signal. */
  readonly arabic: readonly string[];
  /** Host used for feed and Hacker News article links. */
  readonly linkDomain: string;
  readonly repository?: MockRepository;
}

/**
 * Unrelated background chatter. Without a long tail every generated item would
 * belong to a cluster, and the clustering thresholds would never be exercised.
 */
export interface TailItem {
  readonly id: string;
  readonly category: MockCategory;
  readonly title: string;
  readonly body: string;
  readonly language: 'en' | 'ar';
}

export interface MockAuthor {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  /** Rough follower tier, used to scale engagement without a second draw. */
  readonly reach: number;
}

export interface MockFeed {
  readonly id: string;
  readonly title: string;
  readonly feedUrl: string;
  readonly siteUrl: string;
  /** Atom feeds and RSS 2.0 feeds are both present so the parser sees both. */
  readonly format: 'rss' | 'atom';
  readonly categories: readonly MockCategory[];
}
