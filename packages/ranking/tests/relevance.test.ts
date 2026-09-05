import { describe, expect, it } from 'vitest';

import {
  calculateRelevance,
  type InterestInput,
  type RelevanceInput,
} from '../src/relevance';
import { RELEVANCE_TUNING } from '../src/weights';

const EMBEDDING = [0.1, 0.5, -0.3, 0.8];
const ORTHOGONAL = [0.5, -0.1, 0, 0];

function interest(overrides: Partial<InterestInput> = {}): InterestInput {
  return {
    id: 'interest-ai',
    name: 'AI',
    weight: 1,
    enabled: true,
    keywords: [{ keyword: 'AI agents', weight: 1 }],
    ...overrides,
  };
}

function relevanceInput(overrides: Partial<RelevanceInput> = {}): RelevanceInput {
  return {
    title: 'A quiet morning',
    content: 'Nothing in particular happened today.',
    sourceAuthorityWeight: 0,
    aiConfidence: null,
    interests: [],
    ...overrides,
  };
}

/** An input where every signal is at its maximum. */
function perfectInput(aiConfidence: number | null): RelevanceInput {
  return relevanceInput({
    title: 'AI agents, vector databases and retrieval augmented generation',
    content: 'A deep dive into agents, databases and retrieval.',
    embedding: EMBEDDING,
    sourceAuthorityWeight: 1,
    aiConfidence,
    interests: [
      interest({
        embedding: EMBEDDING,
        keywords: [
          { keyword: 'AI agents', weight: 1 },
          { keyword: 'vector databases', weight: 1 },
          { keyword: 'retrieval augmented generation', weight: 1 },
        ],
      }),
    ],
  });
}

describe('keyword scoring', () => {
  it('finds a keyword in the body', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'Weekly roundup',
        content: 'This week we look at AI agents in production.',
        interests: [interest()],
      }),
    );
    expect(result.components.keyword).toBeGreaterThan(0);
    expect(result.matchedKeywords).toEqual(['AI agents']);
    expect(result.matchedInterestIds).toEqual(['interest-ai']);
  });

  it('boosts a title match above the same match in the body', () => {
    const inTitle = calculateRelevance(
      relevanceInput({
        title: 'AI agents everywhere',
        content: 'Nothing relevant here.',
        interests: [interest()],
      }),
    );
    const inBody = calculateRelevance(
      relevanceInput({
        title: 'Nothing relevant here',
        content: 'AI agents everywhere.',
        interests: [interest()],
      }),
    );
    expect(inTitle.components.keyword).toBeGreaterThan(inBody.components.keyword);
    expect(inTitle.components.keyword).toBeCloseTo(
      inBody.components.keyword * RELEVANCE_TUNING.titleMatchBoost,
      6,
    );
  });

  it('counts a keyword once even when it appears in both title and body', () => {
    const both = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        content: 'AI agents again and again, AI agents.',
        interests: [interest()],
      }),
    );
    expect(both.matchedKeywords).toEqual(['AI agents']);
    expect(both.components.keyword).toBeCloseTo(
      (RELEVANCE_TUNING.titleMatchBoost / RELEVANCE_TUNING.keywordSaturation) * 100,
      6,
    );
  });

  it('requires every token of a multi-word keyword', () => {
    const partial = calculateRelevance(
      relevanceInput({
        title: 'A note on vector maths',
        content: 'We talk about vectors and nothing else.',
        interests: [interest({ keywords: [{ keyword: 'vector database', weight: 1 }] })],
      }),
    );
    expect(partial.components.keyword).toBe(0);
    expect(partial.matchedKeywords).toEqual([]);

    const complete = calculateRelevance(
      relevanceInput({
        title: 'A note on storage',
        content: 'Choosing a database means choosing a vector index.',
        interests: [interest({ keywords: [{ keyword: 'vector database', weight: 1 }] })],
      }),
    );
    expect(complete.components.keyword).toBeGreaterThan(0);
  });

  it('saturates: more than the reference number of solid hits does not overshoot', () => {
    const result = calculateRelevance(perfectInput(null));
    expect(result.components.keyword).toBe(100);
  });

  it('scales a hit by both the interest weight and the keyword weight', () => {
    const full = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        interests: [interest()],
      }),
    );
    const halved = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        interests: [interest({ weight: 0.5, keywords: [{ keyword: 'AI agents', weight: 0.5 }] })],
      }),
    );
    expect(halved.components.keyword).toBeCloseTo(full.components.keyword * 0.25, 1);
  });

  it('clamps out-of-range interest and keyword weights', () => {
    const overWeighted = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        interests: [interest({ weight: 9, keywords: [{ keyword: 'AI agents', weight: 9 }] })],
      }),
    );
    const normal = calculateRelevance(relevanceInput({ title: 'AI agents', interests: [interest()] }));
    expect(overWeighted.components.keyword).toBe(normal.components.keyword);
  });

  it('matches Arabic keywords', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'تقرير عن الذكاء الاصطناعي',
        content: 'نظرة على أحدث النماذج',
        interests: [interest({ keywords: [{ keyword: 'الذكاء الاصطناعي', weight: 1 }] })],
      }),
    );
    expect(result.components.keyword).toBeGreaterThan(0);
    expect(result.matchedKeywords).toEqual(['الذكاء الاصطناعي']);
  });

  it('ignores a keyword that tokenises to nothing', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        interests: [interest({ keywords: [{ keyword: '   !!!   ', weight: 1 }] })],
      }),
    );
    expect(result.components.keyword).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
  });

  it('tolerates a null title', () => {
    const result = calculateRelevance(
      relevanceInput({ title: null, content: 'AI agents in production', interests: [interest()] }),
    );
    expect(result.components.keyword).toBeGreaterThan(0);
  });

  it('reports the strongest keyword match first', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'AI agents and vector databases',
        content: 'Also a note on retrieval.',
        interests: [
          interest({
            keywords: [
              { keyword: 'retrieval', weight: 0.1 },
              { keyword: 'AI agents', weight: 1 },
              { keyword: 'vector databases', weight: 0.5 },
            ],
          }),
        ],
      }),
    );
    expect(result.matchedKeywords).toEqual(['AI agents', 'vector databases', 'retrieval']);
  });
});

describe('disabled and zero-weight interests', () => {
  it('contribute nothing to keywords, semantics or the matched lists', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        content: 'AI agents everywhere',
        embedding: EMBEDDING,
        interests: [interest({ enabled: false, embedding: EMBEDDING })],
      }),
    );
    expect(result.components.keyword).toBe(0);
    expect(result.components.semantic).toBe(0);
    expect(result.matchedInterestIds).toEqual([]);
    expect(result.matchedKeywords).toEqual([]);
  });

  it('are skipped when the interest weight is zero', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        embedding: EMBEDDING,
        interests: [interest({ weight: 0, embedding: EMBEDDING })],
      }),
    );
    expect(result.components.keyword).toBe(0);
    expect(result.components.semantic).toBe(0);
    expect(result.relevanceScore).toBe(0);
  });

  it('do not suppress an enabled sibling interest', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        interests: [interest({ id: 'off', enabled: false }), interest({ id: 'on' })],
      }),
    );
    expect(result.matchedInterestIds).toEqual(['on']);
  });
});

describe('semantic scoring', () => {
  it('is zero without a content embedding', () => {
    const result = calculateRelevance(
      relevanceInput({ interests: [interest({ embedding: EMBEDDING })] }),
    );
    expect(result.components.semantic).toBe(0);
  });

  it('is zero for an empty content embedding', () => {
    const result = calculateRelevance(
      relevanceInput({ embedding: [], interests: [interest({ embedding: EMBEDDING })] }),
    );
    expect(result.components.semantic).toBe(0);
  });

  it('is zero when the interest has no embedding of its own', () => {
    const result = calculateRelevance(
      relevanceInput({ embedding: EMBEDDING, interests: [interest()] }),
    );
    expect(result.components.semantic).toBe(0);
    expect(result.matchedInterestIds).toEqual([]);
  });

  it('is zero when the dimensionalities disagree, rather than comparing prefixes', () => {
    const result = calculateRelevance(
      relevanceInput({
        embedding: EMBEDDING,
        interests: [interest({ embedding: [0.1, 0.5] })],
      }),
    );
    expect(result.components.semantic).toBe(0);
  });

  it('is 100 for an identical embedding', () => {
    const result = calculateRelevance(
      relevanceInput({ embedding: EMBEDDING, interests: [interest({ embedding: EMBEDDING })] }),
    );
    expect(result.components.semantic).toBe(100);
    expect(result.matchedInterestIds).toEqual(['interest-ai']);
  });

  it('is zero below the similarity floor', () => {
    const result = calculateRelevance(
      relevanceInput({
        embedding: [1, 0, 0, 0],
        interests: [interest({ embedding: [0, 1, 0, 0] })],
      }),
    );
    expect(result.components.semantic).toBe(0);
    expect(result.matchedInterestIds).toEqual([]);
  });

  it('takes the strongest interest and scales it by that interest weight', () => {
    const result = calculateRelevance(
      relevanceInput({
        embedding: EMBEDDING,
        interests: [
          interest({ id: 'weak', embedding: ORTHOGONAL }),
          interest({ id: 'strong', embedding: EMBEDDING, weight: 0.5 }),
        ],
      }),
    );
    expect(result.components.semantic).toBe(50);
    expect(result.matchedInterestIds).toContain('strong');
  });

  it('adds a semantically matched interest to the matched list even without keywords', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'Completely unrelated headline',
        content: 'Completely unrelated body.',
        embedding: EMBEDDING,
        interests: [interest({ embedding: EMBEDDING })],
      }),
    );
    expect(result.matchedKeywords).toEqual([]);
    expect(result.matchedInterestIds).toEqual(['interest-ai']);
  });
});

describe('source quality', () => {
  it('passes the configured authority weight straight through, clamped', () => {
    const sourceQualityFor = (weight: number): number =>
      calculateRelevance(relevanceInput({ sourceAuthorityWeight: weight })).components.sourceQuality;
    expect(sourceQualityFor(0.7)).toBe(70);
    expect(sourceQualityFor(5)).toBe(100);
    expect(sourceQualityFor(-1)).toBe(0);
  });
});

describe('AI classification and weight renormalisation', () => {
  it('reports a null AI component when classification is disabled', () => {
    const result = calculateRelevance(relevanceInput({ aiConfidence: null }));
    expect(result.components.aiClassification).toBeNull();
  });

  it('reports the AI component as a 0..100 value when enabled', () => {
    expect(
      calculateRelevance(relevanceInput({ aiConfidence: 0.42 })).components.aiClassification,
    ).toBe(42);
    expect(calculateRelevance(relevanceInput({ aiConfidence: 9 })).components.aiClassification).toBe(
      100,
    );
    expect(
      calculateRelevance(relevanceInput({ aiConfidence: -1 })).components.aiClassification,
    ).toBe(0);
  });

  it('reaches 100 for a perfect match in BOTH modes', () => {
    expect(calculateRelevance(perfectInput(1)).relevanceScore).toBe(100);
    expect(calculateRelevance(perfectInput(null)).relevanceScore).toBe(100);
  });

  it('renormalises so a partial match is not penalised for having no classifier', () => {
    // Keyword and semantic at full strength, source quality at zero: with AI
    // off the two surviving terms carry 87.5% of the scale rather than 70%.
    const base = {
      title: 'AI agents',
      content: 'AI agents everywhere',
      embedding: EMBEDDING,
      sourceAuthorityWeight: 0,
      interests: [
        interest({
          embedding: EMBEDDING,
          keywords: [
            { keyword: 'AI agents', weight: 1 },
            { keyword: 'agents', weight: 1 },
            { keyword: 'everywhere', weight: 1 },
          ],
        }),
      ],
    };
    const withoutAi = calculateRelevance(relevanceInput({ ...base, aiConfidence: null }));
    const withAi = calculateRelevance(relevanceInput({ ...base, aiConfidence: 0 }));
    expect(withoutAi.components).toEqual({ ...withAi.components, aiClassification: null });
    expect(withoutAi.relevanceScore).toBe(87.5);
    expect(withAi.relevanceScore).toBe(70);
  });

  it('lets a confident classifier lift a score above what the other terms alone reach', () => {
    const base = {
      title: 'AI agents',
      content: 'AI agents everywhere',
      sourceAuthorityWeight: 1,
      interests: [interest()],
    };
    const withAi = calculateRelevance(relevanceInput({ ...base, aiConfidence: 1 }));
    const withoutAi = calculateRelevance(relevanceInput({ ...base, aiConfidence: null }));
    expect(withAi.relevanceScore).toBeGreaterThan(withoutAi.relevanceScore);
  });
});

describe('calculateRelevance overall', () => {
  it('is zero when nothing matches at all', () => {
    const result = calculateRelevance(relevanceInput({ interests: [interest()] }));
    expect(result.relevanceScore).toBe(0);
    expect(result.matchedInterestIds).toEqual([]);
    expect(result.matchedKeywords).toEqual([]);
  });

  it('handles an empty interest list', () => {
    const result = calculateRelevance(
      relevanceInput({ interests: [], sourceAuthorityWeight: 1, aiConfidence: 1 }),
    );
    expect(result.components.keyword).toBe(0);
    expect(result.components.semantic).toBe(0);
    expect(result.relevanceScore).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const input = perfectInput(0.6);
    expect(calculateRelevance(input)).toEqual(calculateRelevance(input));
  });

  it('stays inside 0..100 for every component and the score', () => {
    const inputs = [
      relevanceInput(),
      perfectInput(1),
      perfectInput(null),
      relevanceInput({ sourceAuthorityWeight: 99, aiConfidence: 99, interests: [interest()] }),
    ];
    for (const input of inputs) {
      const result = calculateRelevance(input);
      for (const value of Object.values(result.components)) {
        if (value === null) continue;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(result.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(result.relevanceScore).toBeLessThanOrEqual(100);
    }
  });

  it('de-duplicates interests matched both by keyword and by embedding', () => {
    const result = calculateRelevance(
      relevanceInput({
        title: 'AI agents',
        embedding: EMBEDDING,
        interests: [interest({ embedding: EMBEDDING })],
      }),
    );
    expect(result.matchedInterestIds).toEqual(['interest-ai']);
  });

  it('rounds every reported number to two decimal places', () => {
    const result = calculateRelevance(perfectInput(0.333_333));
    const values = [
      result.components.keyword,
      result.components.semantic,
      result.components.sourceQuality,
      result.components.aiClassification ?? 0,
      result.relevanceScore,
    ];
    for (const value of values) {
      expect(value).toBe(Math.round(value * 100) / 100);
    }
  });
});
