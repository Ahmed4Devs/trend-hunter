import { describe, expect, it } from 'vitest';

import {
  buildPostProfile,
  buildTopicProfile,
  calculateSimilarity,
  hoursOutsideWindow,
  timeProximity,
} from '../src/similarity';
import { extractContentTokens, extractEntities, stemLatin } from '../src/text';
import { CLUSTER_DEFAULTS, SIMILARITY_TUNING } from '../src/weights';

import {
  hoursAfter,
  makePost,
  OPENAI_LAUNCH_POSTS,
  SAME_COMPANY_OTHER_STORY,
  T0,
  topicFromPost,
  UNRELATED_POST,
  
} from './fixtures';

const [X_POST, REDDIT_POST, HN_POST, RSS_POST] = OPENAI_LAUNCH_POSTS;
const THRESHOLD = CLUSTER_DEFAULTS.assignmentThreshold;

describe('calculateSimilarity', () => {
  const topic = topicFromPost(X_POST!);

  it('matches every other source of the same launch above the assignment threshold', () => {
    for (const post of [REDDIT_POST!, HN_POST!, RSS_POST!]) {
      const result = calculateSimilarity(post, topic);
      expect(result.similarity, `${post.source} similarity`).toBeGreaterThan(THRESHOLD);
      expect(result.embeddingAvailable).toBe(true);
      expect(result.components.entityOverlap).toBeGreaterThan(0.5);
    }
  });

  it('keeps a different story about the same company apart', () => {
    const result = calculateSimilarity(SAME_COMPANY_OTHER_STORY, topic);
    expect(result.similarity).toBeLessThan(THRESHOLD);
    // The shared company name is real signal and is reported as such; it is
    // simply not enough on its own.
    expect(result.components.entityOverlap).toBeGreaterThan(0);
    expect(result.components.embedding).toBe(0);
  });

  it('finds nothing in common with an unrelated launch', () => {
    const result = calculateSimilarity(UNRELATED_POST, topic);
    expect(result.similarity).toBeLessThan(0.2);
    expect(result.components.tokenOverlap).toBe(0);
    expect(result.components.entityOverlap).toBe(0);
  });

  it('reports components that reconstruct the composite', () => {
    const result = calculateSimilarity(RSS_POST!, topic);
    expect(result.similarity).toBeCloseTo(result.textualScore * result.timeGate, 3);
    for (const value of Object.values(result.components)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a three-day-old topic even when the wording is identical', () => {
    const later = makePost({
      ...X_POST!,
      id: 'x-repeat',
      title: X_POST!.title,
      content: X_POST!.content,
      embedding: X_POST!.embedding,
      publishedAt: hoursAfter(T0, 72),
    });
    const result = calculateSimilarity(later, topic);

    expect(result.components.tokenOverlap).toBeGreaterThan(0.9);
    expect(result.components.embedding).toBe(1);
    expect(result.textualScore).toBeGreaterThan(0.9);
    // ...and the composite still refuses, because only time separates them.
    expect(result.similarity).toBeLessThan(THRESHOLD);
    expect(result.hoursApart).toBe(72);
  });

  it('decays with distance from the topic window rather than from its start', () => {
    const running = topicFromPost(X_POST!, { lastDetectedAt: hoursAfter(T0, 48) });
    const inside = calculateSimilarity(
      makePost({ ...RSS_POST!, id: 'inside', publishedAt: hoursAfter(T0, 40) }),
      running,
    );
    expect(inside.hoursApart).toBe(0);
    expect(inside.components.timeProximity).toBe(1);
  });

  it('redistributes the embedding weight when a post has not been embedded yet', () => {
    const unembedded = makePost({ ...REDDIT_POST!, id: 'reddit-raw', embedding: undefined });
    const textOnlyTopic = topicFromPost(X_POST!, { embedding: undefined });
    const result = calculateSimilarity(unembedded, textOnlyTopic);

    expect(result.embeddingAvailable).toBe(false);
    expect(result.components.embedding).toBe(0);
    // Without redistribution the composite would be capped at 0.45 and every
    // pre-embedding post would start its own topic.
    expect(result.similarity).toBeGreaterThan(THRESHOLD);
  });

  it('drops the embedding signal when the two vectors have different widths', () => {
    const post = makePost({ ...X_POST!, id: 'narrow', embedding: [1, 0, 0] });
    const result = calculateSimilarity(post, topic);
    expect(result.embeddingAvailable).toBe(false);
    expect(result.components.embedding).toBe(0);
  });
});

describe('calculateSimilarity with Arabic content', () => {
  const arabicPost = makePost({
    id: 'ar-1',
    source: 'RSS',
    title: 'أوبن إيه آي تطلق نموذج XYZ الجديد',
    content: 'أعلنت أوبن إيه آي عن إطلاق نموذج XYZ الجديد للمطورين اليوم.',
    publishedAt: T0,
  });
  const arabicTopic = topicFromPost(arabicPost);

  it('clusters two Arabic reports of the same launch', () => {
    const second = makePost({
      id: 'ar-2',
      source: 'X',
      title: 'إطلاق نموذج XYZ من أوبن إيه آي',
      content: 'أطلقت أوبن إيه آي نموذج XYZ الجديد وهو متاح للمطورين.',
      publishedAt: hoursAfter(T0, 1),
    });
    const result = calculateSimilarity(second, arabicTopic);
    expect(result.similarity).toBeGreaterThan(THRESHOLD);
    expect(result.components.tokenOverlap).toBeGreaterThan(0.5);
  });

  it('keeps an unrelated Arabic story out', () => {
    const football = makePost({
      id: 'ar-3',
      source: 'X',
      title: 'الهلال يفوز بكأس السوبر',
      content: 'فاز فريق الهلال بكأس السوبر بعد مباراة مثيرة أمام النصر.',
      publishedAt: hoursAfter(T0, 2),
    });
    expect(calculateSimilarity(football, arabicTopic).similarity).toBeLessThan(0.2);
  });

  it('redistributes the entity weight when neither side carries a Latin name', () => {
    const post = makePost({
      id: 'ar-4',
      source: 'X',
      title: 'أوبن إيه آي تطلق نموذج جديد',
      content: 'أوبن إيه آي تطلق نموذج جديد.',
      publishedAt: T0,
    });
    const topic = topicFromPost(
      makePost({
        id: 'ar-5',
        title: 'إطلاق نموذج جديد من أوبن إيه آي',
        content: 'إطلاق نموذج جديد من أوبن إيه آي.',
        publishedAt: T0,
      }),
    );
    const result = calculateSimilarity(post, topic);

    expect(result.entitiesAvailable).toBe(false);
    // Only the token signal survives, so it alone drives the composite.
    expect(result.textualScore).toBeCloseTo(result.components.tokenOverlap, 3);
    expect(result.similarity).toBeGreaterThan(THRESHOLD);
  });

  it('folds Arabic orthography so spelling variants compare equal', () => {
    const withDiacritics = extractContentTokens('الذَّكاء الاصطناعي');
    const without = extractContentTokens('الذكاء الاصطناعي');
    expect([...withDiacritics].sort()).toStrictEqual([...without].sort());
  });
});

describe('token and entity extraction', () => {
  it('drops function words in both languages', () => {
    expect(extractContentTokens('the model is out')).toStrictEqual(new Set(['model']));
    expect(extractContentTokens('من الذي أطلق هذا')).toStrictEqual(new Set(['اطلق']));
  });

  it('folds inflections onto a shared stem', () => {
    expect(stemLatin('releases')).toBe(stemLatin('released'));
    expect(stemLatin('releases')).toBe(stemLatin('release'));
    expect(stemLatin('launched')).toBe('launch');
    expect(stemLatin('hires')).toBe('hire');
    // Guarded against over-stemming a short word into a different one.
    expect(stemLatin('news')).toBe('news');
    expect(stemLatin('gpt-5')).toBe('gpt-5');
  });

  it('collects product names and organisations, not sentence filler', () => {
    const entities = extractEntities('OpenAI ships GPT-5 and the iPhone app is updated');
    expect(entities.has('openai')).toBe(true);
    expect(entities.has('gpt-5')).toBe(true);
    expect(entities.has('iphone')).toBe(true);
    expect(entities.has('the')).toBe(false);
    expect(entities.has('and')).toBe(false);
  });

  it('returns nothing for an empty or symbol-only text', () => {
    expect(extractContentTokens('')).toStrictEqual(new Set());
    expect(extractEntities('!!! ---')).toStrictEqual(new Set());
  });
});

describe('profiles', () => {
  it('strips source boilerplate before comparing', () => {
    const profile = buildPostProfile(
      makePost({ id: 'hn-x', title: 'Show HN: OpenAI XYZ launched', content: '' }),
    );
    expect(profile.headlineTokens.has('hn')).toBe(false);
    expect(profile.headlineTokens.has('openai')).toBe(true);
  });

  it('falls back to the body when a post has no title', () => {
    const profile = buildPostProfile(
      makePost({ id: 'x-3', title: null, content: 'OpenAI released XYZ today.' }),
    );
    expect(profile.headlineTokens.has('openai')).toBe(true);
  });

  it('reads a topic summary and its accumulated key terms', () => {
    const profile = buildTopicProfile({
      id: 't',
      name: 'OpenAI releases XYZ',
      summary: 'A new reasoning model.',
      keyTerms: ['benchmark'],
      firstDetectedAt: T0,
      lastDetectedAt: T0,
      postCount: 3,
    });
    expect(profile.allTokens.has('reason')).toBe(true);
    expect(profile.allTokens.has('benchmark')).toBe(true);
    expect(profile.headlineTokens.has('benchmark')).toBe(false);
  });
});

describe('time proximity', () => {
  it('is zero inside the window and grows from the nearest edge', () => {
    const from = T0;
    const to = hoursAfter(T0, 10);
    expect(hoursOutsideWindow(hoursAfter(T0, 4), from, to)).toBe(0);
    expect(hoursOutsideWindow(hoursAfter(T0, 12), from, to)).toBe(2);
    expect(hoursOutsideWindow(hoursAfter(T0, -3), from, to)).toBe(3);
  });

  it('halves at the configured half-life and never treats a bad date as now', () => {
    expect(timeProximity(0)).toBe(1);
    expect(timeProximity(SIMILARITY_TUNING.timeProximityHalfLifeHours)).toBeCloseTo(0.5, 6);
    expect(timeProximity(Number.POSITIVE_INFINITY)).toBe(0);
    expect(timeProximity(Number.NaN)).toBe(0);
  });

  it('reports an unusable timestamp as an infinite gap', () => {
    const result = calculateSimilarity(
      makePost({ ...X_POST!, id: 'broken', publishedAt: new Date('nonsense') }),
      topicFromPost(X_POST!),
    );
    expect(result.hoursApart).toBe(Number.POSITIVE_INFINITY);
    expect(result.components.timeProximity).toBe(0);
  });
});
