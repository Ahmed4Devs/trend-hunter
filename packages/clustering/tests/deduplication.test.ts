import { describe, expect, it } from 'vitest';

import {
  findExactDuplicate,
  findNearDuplicate,
  resolveDuplicate,
  selectSurvivor,
} from '../src/deduplication';
import type { ClusterablePost } from '../src/similarity';

import { hoursAfter, makePost, OPENAI_LAUNCH_POSTS, T0, vector } from './fixtures';

const [X_POST] = OPENAI_LAUNCH_POSTS;

const WIRE_TEXT = 'OpenAI announces XYZ, a new model available to developers from today.';
const WIRE_EMBEDDING = vector({ openai: 1, xyz: 0.9, launch: 0.85, model: 0.7 });

/** The same wire story, collected twice under different ids. */
const wireCopy = (overrides: Partial<Parameters<typeof makePost>[0]> & { id: string }) =>
  makePost({
    title: 'OpenAI announces XYZ',
    content: WIRE_TEXT,
    embedding: WIRE_EMBEDDING,
    ...overrides,
  });

describe('findExactDuplicate', () => {
  const original = wireCopy({ id: 'rss-a', source: 'RSS', publishedAt: T0 });

  it('matches on the content fingerprint across sources and formats', () => {
    const reposted = makePost({
      id: 'x-a',
      source: 'X',
      title: 'OpenAI announces XYZ!',
      content: 'openai announces xyz, a new model available to developers from today.',
      publishedAt: hoursAfter(T0, 1),
    });
    // The shared fingerprint is what the ingestion pipeline computed; it folds
    // case and punctuation, which is exactly the kind of difference two sources
    // introduce when they carry one text.
    const sameHash = makePost({ ...reposted, contentHash: original.contentHash });

    const match = findExactDuplicate(sameHash, [original]);
    expect(match?.reason).toBe('CONTENT_HASH');
    expect(match?.candidate.id).toBe('rss-a');
    expect(match?.similarity).toBe(1);
    expect(match?.hoursApart).toBe(1);
  });

  it('matches on the canonical URL when the text was rewritten', () => {
    const rewritten = makePost({
      id: 'rss-b',
      source: 'RSS',
      title: 'OpenAI announces XYZ (updated)',
      content: 'A rewritten summary of the same article.',
      canonicalUrl: original.canonicalUrl,
      publishedAt: hoursAfter(T0, 6),
    });

    expect(findExactDuplicate(rewritten, [original])?.reason).toBe('CANONICAL_URL');
  });

  it('prefers the fingerprint over the URL when both would match', () => {
    const byUrlOnly = makePost({
      id: 'other',
      canonicalUrl: original.canonicalUrl,
      content: 'Something else entirely.',
      publishedAt: T0,
    });
    const byHash = makePost({ ...original, id: 'twin', canonicalUrl: 'https://elsewhere.test/a' });

    const match = findExactDuplicate(original, [byUrlOnly, byHash]);
    expect(match?.reason).toBe('CONTENT_HASH');
    expect(match?.candidate.id).toBe('twin');
  });

  it('never matches a record against itself and ignores an empty URL', () => {
    expect(findExactDuplicate(original, [original])).toBeNull();

    const blankUrl = makePost({ id: 'blank-1', canonicalUrl: '', content: 'one' });
    const otherBlank = makePost({ id: 'blank-2', canonicalUrl: '', content: 'two' });
    expect(findExactDuplicate(blankUrl, [otherBlank])).toBeNull();
  });

  it('returns the earliest candidate when several are duplicates', () => {
    const early = makePost({ ...original, id: 'early', publishedAt: hoursAfter(T0, -2) });
    const late = makePost({ ...original, id: 'late', publishedAt: hoursAfter(T0, 2) });

    expect(findExactDuplicate(original, [late, early])?.candidate.id).toBe('early');
    expect(findExactDuplicate(original, [early, late])?.candidate.id).toBe('early');
  });
});

describe('findNearDuplicate', () => {
  const original = wireCopy({ id: 'rss-a', source: 'RSS', publishedAt: T0 });

  it('catches the same text republished by another source hours later', () => {
    const syndicated = wireCopy({
      id: 'hn-a',
      source: 'HACKERNEWS',
      title: 'OpenAI announces XYZ',
      publishedAt: hoursAfter(T0, 3),
    });

    const match = findNearDuplicate(syndicated, [original]);
    expect(match?.candidate.id).toBe('rss-a');
    expect(match?.reason).toBe('EMBEDDING');
    expect(match?.similarity).toBe(1);
  });

  it('refuses the same text a day later, which is a revisit rather than a copy', () => {
    const later = wireCopy({ id: 'hn-b', publishedAt: hoursAfter(T0, 30) });
    expect(findNearDuplicate(later, [original])).toBeNull();
    expect(findNearDuplicate(later, [original], { windowHours: 48 })?.candidate.id).toBe('rss-a');
  });

  it('refuses a merely similar post, however close in time', () => {
    const related = makePost({
      id: 'x-b',
      title: 'OpenAI XYZ launched',
      content: 'OpenAI XYZ launched today, with a new pricing page for developers.',
      embedding: vector({ openai: 1, xyz: 0.95, launch: 0.95, model: 0.5, developers: 0.4 }),
      publishedAt: hoursAfter(T0, 1),
    });
    expect(findNearDuplicate(related, [original])).toBeNull();
  });

  it('returns nothing when either side has no embedding or a different width', () => {
    const unembedded = wireCopy({ id: 'hn-c', embedding: undefined, publishedAt: T0 });
    expect(findNearDuplicate(unembedded, [original])).toBeNull();
    expect(findNearDuplicate(original, [unembedded])).toBeNull();
    expect(findNearDuplicate(original, [wireCopy({ id: 'hn-d', embedding: [1, 0] })])).toBeNull();
  });

  it('picks the strongest match, and the earliest when two are equally strong', () => {
    const twinEarly = wireCopy({ id: 'z-early', publishedAt: hoursAfter(T0, -1) });
    const twinLate = wireCopy({ id: 'a-late', publishedAt: hoursAfter(T0, 1) });
    const post = wireCopy({ id: 'subject', publishedAt: T0 });

    expect(findNearDuplicate(post, [twinLate, twinEarly])?.candidate.id).toBe('z-early');
    expect(findNearDuplicate(post, [twinEarly, twinLate])?.candidate.id).toBe('z-early');
  });
});

describe('resolveDuplicate', () => {
  const earlier = makePost({
    id: 'b-earlier',
    publishedAt: T0,
    sourceAuthorityWeight: 0.2,
  });
  const later = makePost({
    id: 'a-later',
    publishedAt: hoursAfter(T0, 4),
    sourceAuthorityWeight: 0.9,
  });

  it('keeps the earliest publication, whichever way round it is asked', () => {
    expect(resolveDuplicate(earlier, later).keep.id).toBe('b-earlier');
    expect(resolveDuplicate(later, earlier).keep.id).toBe('b-earlier');
    expect(resolveDuplicate(later, earlier).reason).toBe('EARLIEST_PUBLISHED');
  });

  it('falls back to source authority when the timestamps are identical', () => {
    const weak = makePost({ id: 'a', publishedAt: T0, sourceAuthorityWeight: 0.3 });
    const strong = makePost({ id: 'b', publishedAt: T0, sourceAuthorityWeight: 0.95 });

    const resolution = resolveDuplicate(weak, strong);
    expect(resolution.keep.id).toBe('b');
    expect(resolution.reason).toBe('HIGHER_AUTHORITY');
  });

  it('falls back to the id so the verdict is total, not arbitrary', () => {
    const first = makePost({ id: 'aaa', publishedAt: T0, sourceAuthorityWeight: 0.5 });
    const second = makePost({ id: 'bbb', publishedAt: T0, sourceAuthorityWeight: 0.5 });

    expect(resolveDuplicate(second, first).keep.id).toBe('aaa');
    expect(resolveDuplicate(second, first).reason).toBe('STABLE_ID_ORDER');
  });
});

describe('selectSurvivor', () => {
  const records: readonly ClusterablePost[] = [
    makePost({ id: 'c', publishedAt: hoursAfter(T0, 2), sourceAuthorityWeight: 0.9 }),
    makePost({ id: 'a', publishedAt: T0, sourceAuthorityWeight: 0.4 }),
    makePost({ id: 'b', publishedAt: T0, sourceAuthorityWeight: 0.8 }),
    makePost({ id: 'd', publishedAt: hoursAfter(T0, 5), sourceAuthorityWeight: 1 }),
  ];

  it('is idempotent under re-runs and independent of the input order', () => {
    const survivor = selectSurvivor(records);
    expect(survivor?.id).toBe('b');

    const orders = [
      [...records].reverse(),
      [records[2]!, records[0]!, records[3]!, records[1]!],
      [records[1]!, records[2]!, records[0]!, records[3]!],
    ];
    for (const order of orders) {
      expect(selectSurvivor(order)?.id).toBe('b');
    }
    expect(selectSurvivor([survivor!])?.id).toBe('b');
  });

  it('returns null for an empty set', () => {
    expect(selectSurvivor([])).toBeNull();
  });

  it('leaves a single record alone', () => {
    expect(selectSurvivor([X_POST!])?.id).toBe(X_POST!.id);
  });
});
