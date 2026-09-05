import { canonicalizeUrl, contentHash } from '@trendhunter/shared';
import type { SourceKind } from '@trendhunter/types';

import type { ClusterablePost, ClusterableTopic } from '../src/similarity';

/**
 * Test fixtures.
 *
 * The embeddings here are eleven-dimensional bags over named axes rather than
 * the 768-dimensional vectors production uses. They stand in for an encoder,
 * and they are built to reproduce the property the engine depends on: two
 * headlines about one event land close together (cosine well above 0.9) while
 * two headlines about different events do not (cosine well below 0.5). The
 * geometry of cosine similarity does not care about the dimension count, so a
 * readable eleven is worth more here than an opaque 768.
 */
export const AXES = [
  'openai',
  'xyz',
  'model',
  'launch',
  'developers',
  'community',
  'apple',
  'hardware',
  'hiring',
  'football',
  'arabic',
] as const;

export type Axis = (typeof AXES)[number];

export function vector(weights: Partial<Record<Axis, number>>): number[] {
  return AXES.map((axis) => weights[axis] ?? 0);
}

export const T0 = new Date('2026-09-04T09:00:00.000Z');

export function hoursAfter(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000);
}

export interface PostOverrides {
  readonly id: string;
  readonly source?: SourceKind;
  readonly title?: string | null;
  readonly content?: string;
  readonly url?: string;
  readonly canonicalUrl?: string;
  readonly contentHash?: string;
  readonly publishedAt?: Date;
  readonly embedding?: readonly number[] | undefined;
  readonly sourceAuthorityWeight?: number;
  readonly engagementScore?: number;
}

export function makePost(overrides: PostOverrides): ClusterablePost {
  const title = overrides.title === undefined ? null : overrides.title;
  const content = overrides.content ?? '';
  const url = overrides.url ?? `https://example.test/${overrides.id}`;
  return {
    id: overrides.id,
    source: overrides.source ?? 'X',
    title,
    content,
    canonicalUrl: overrides.canonicalUrl ?? canonicalizeUrl(url),
    contentHash: overrides.contentHash ?? contentHash(title ?? '', content),
    publishedAt: overrides.publishedAt ?? T0,
    embedding: overrides.embedding,
    sourceAuthorityWeight: overrides.sourceAuthorityWeight ?? 0.5,
    engagementScore: overrides.engagementScore ?? 0,
  };
}

/** Builds the topic a post would have created, as the worker would store it. */
export function topicFromPost(
  post: ClusterablePost,
  overrides: Partial<ClusterableTopic> = {},
): ClusterableTopic {
  return {
    id: `topic-${post.id}`,
    name: post.title ?? post.content,
    summary: null,
    embedding: post.embedding,
    firstDetectedAt: post.publishedAt,
    lastDetectedAt: post.publishedAt,
    postCount: 1,
    ...overrides,
  };
}

/**
 * The worked example from the product spec: one launch, four sources, four very
 * different ways of saying it.
 */
export const OPENAI_LAUNCH_POSTS: readonly ClusterablePost[] = [
  makePost({
    id: 'x-1',
    source: 'X',
    title: 'OpenAI releases XYZ',
    content: 'OpenAI releases XYZ, its new reasoning model, to every developer today.',
    publishedAt: T0,
    sourceAuthorityWeight: 0.7,
    engagementScore: 60,
    embedding: vector({ openai: 1, xyz: 0.95, launch: 0.9, model: 0.6, developers: 0.3 }),
  }),
  makePost({
    id: 'reddit-1',
    source: 'REDDIT',
    title: 'Thoughts about new OpenAI XYZ?',
    content:
      'OpenAI released XYZ today. Has anyone tried the new model yet? Curious how it compares for developers.',
    publishedAt: hoursAfter(T0, 2),
    sourceAuthorityWeight: 0.5,
    engagementScore: 80,
    embedding: vector({ openai: 1, xyz: 0.9, launch: 0.7, model: 0.75, community: 0.4 }),
  }),
  makePost({
    id: 'hn-1',
    source: 'HACKERNEWS',
    title: 'Show HN: OpenAI XYZ launched',
    content: 'OpenAI XYZ launched today, with a new pricing page for developers.',
    publishedAt: hoursAfter(T0, 3),
    sourceAuthorityWeight: 0.8,
    engagementScore: 40,
    embedding: vector({ openai: 1, xyz: 0.95, launch: 0.95, model: 0.5, developers: 0.4 }),
  }),
  makePost({
    id: 'rss-1',
    source: 'RSS',
    title: 'OpenAI announces XYZ - The Verge',
    content: 'OpenAI announces XYZ, a new model available to developers from today.',
    publishedAt: hoursAfter(T0, 5),
    sourceAuthorityWeight: 0.9,
    engagementScore: 20,
    embedding: vector({ openai: 1, xyz: 0.9, launch: 0.85, model: 0.7, developers: 0.35 }),
  }),
];

/** A different event, same day, sharing nothing but the calendar. */
export const UNRELATED_POST: ClusterablePost = makePost({
  id: 'x-2',
  source: 'X',
  title: 'Apple ships the new MacBook Pro',
  content: 'Apple ships the new MacBook Pro with its M6 chip and a brighter display.',
  publishedAt: hoursAfter(T0, 1),
  sourceAuthorityWeight: 0.7,
  embedding: vector({ apple: 1, hardware: 0.9, launch: 0.4 }),
});

/** Same company, different story — the case a naive entity match gets wrong. */
export const SAME_COMPANY_OTHER_STORY: ClusterablePost = makePost({
  id: 'rss-2',
  source: 'RSS',
  title: 'OpenAI hires a new chief financial officer',
  content: 'OpenAI hires a new chief financial officer ahead of its next funding round.',
  publishedAt: hoursAfter(T0, 4),
  sourceAuthorityWeight: 0.9,
  embedding: vector({ openai: 1, hiring: 0.9 }),
});
