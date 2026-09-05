import { containsArabicScript, characterCount, X_POST_CHARACTER_LIMIT } from '@trendhunter/shared';
import type { GenerateRequest, GeneratedThread, GenerationContext } from '@trendhunter/types';
import { describe, expect, it } from 'vitest';

import { MockLlmProvider, UNCLASSIFIED_LABEL } from '../src/mock-provider';

/**
 * The offline provider is the one the whole product runs on in development, so
 * these tests treat it as a real implementation rather than a stub: determinism,
 * genuine Arabic output, honoured character budgets and honoured terminology
 * preferences are all product requirements, not implementation details.
 */

const provider = new MockLlmProvider();

const CONTEXT: GenerationContext = {
  topicName: 'OpenAI releases a new agent framework',
  topicSummary:
    'A new framework for building autonomous agents, with tool use and long-running tasks.',
  sourceExcerpts: [
    'The framework ships with a scheduler and a memory store.',
    'Developers report it removes most of the glue code they were writing.',
  ],
  interests: ['AI Agents', 'Developer Tools'],
  arabicOpportunityScore: 88,
};

function generateRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    kind: 'SHORT_X_POST',
    language: 'EN',
    tone: 'NEUTRAL',
    context: CONTEXT,
    ...overrides,
  };
}

function isThread(value: unknown): value is GeneratedThread {
  return typeof value === 'object' && value !== null && 'posts' in value;
}

describe('MockLlmProvider.generate', () => {
  it('is deterministic for identical requests', async () => {
    const first = await provider.generate(generateRequest());
    const second = await provider.generate(generateRequest());
    expect(first.value).toStrictEqual(second.value);
  });

  it('produces different content for a different topic', async () => {
    const other = await provider.generate(
      generateRequest({ context: { ...CONTEXT, topicName: 'Kubernetes cost optimisation' } }),
    );
    const base = await provider.generate(generateRequest());
    expect(other.value).not.toStrictEqual(base.value);
  });

  it('draws on the topic it was given rather than emitting filler', async () => {
    const result = await provider.generate(generateRequest());
    expect(isThread(result.value)).toBe(false);
    if (isThread(result.value)) return;
    const text = result.value.content.toLowerCase();
    expect(text).toContain('openai');
    expect(result.value.content.length).toBeGreaterThan(40);
  });

  it('respects the X character limit for a short post', async () => {
    for (const topicName of [
      'OpenAI releases a new agent framework',
      'A very long topic name that goes on and on describing an announcement in detail',
      'RAG',
    ]) {
      const result = await provider.generate(
        generateRequest({ context: { ...CONTEXT, topicName } }),
      );
      if (isThread(result.value)) continue;
      expect(characterCount(result.value.content)).toBeLessThanOrEqual(X_POST_CHARACTER_LIMIT);
      expect(result.value.characterCount).toBe(characterCount(result.value.content));
    }
  });

  it('respects an explicit maxCharacters budget', async () => {
    const result = await provider.generate(generateRequest({ maxCharacters: 120 }));
    if (isThread(result.value)) throw new Error('expected a post');
    expect(characterCount(result.value.content)).toBeLessThanOrEqual(120);
  });

  it('builds a thread with the requested number of posts', async () => {
    const result = await provider.generate(
      generateRequest({ kind: 'X_THREAD', threadLength: 6 }),
    );
    expect(isThread(result.value)).toBe(true);
    if (!isThread(result.value)) return;
    expect(result.value.posts).toHaveLength(6);
    expect(result.value.title.length).toBeGreaterThan(0);
    for (const post of result.value.posts) {
      expect(characterCount(post.content)).toBeLessThanOrEqual(X_POST_CHARACTER_LIMIT);
      expect(post.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('produces thread posts that differ from one another', async () => {
    const result = await provider.generate(
      generateRequest({ kind: 'X_THREAD', threadLength: 5 }),
    );
    if (!isThread(result.value)) return;
    const contents = result.value.posts.map((post) => post.content);
    expect(new Set(contents).size).toBe(contents.length);
  });

  it('generates Arabic content when asked for Arabic', async () => {
    const result = await provider.generate(generateRequest({ language: 'AR' }));
    if (isThread(result.value)) return;
    expect(containsArabicScript(result.value.content)).toBe(true);
  });

  it('reports zero cost, because the offline provider spends nothing', async () => {
    const result = await provider.generate(generateRequest());
    expect(result.meta.usage.estimatedCost).toBe(0);
    expect(result.meta.usage.totalTokens).toBeGreaterThan(0);
    expect(result.meta.provider).toBe('mock');
  });
});

describe('MockLlmProvider.translate', () => {
  const base = {
    text: 'OpenAI released a new AI Agent framework. The SDK exposes a simple API for developers.',
    sourceLanguage: 'EN',
    targetLanguage: 'AR',
    mode: 'X_STYLE',
    terminologyPreference: 'KEEP_COMMON_ENGLISH_TERMS',
    preserveTerms: ['API', 'SDK', 'AI Agent'],
  } as const;

  it('is deterministic', async () => {
    const first = await provider.translate({ ...base });
    const second = await provider.translate({ ...base });
    expect(first.value).toStrictEqual(second.value);
  });

  it('returns genuine Arabic rather than the English input', async () => {
    const result = await provider.translate({ ...base });
    expect(containsArabicScript(result.value.translatedText)).toBe(true);
    expect(result.value.translatedText).not.toBe(base.text);
  });

  it('keeps every preserved term in Latin script', async () => {
    const result = await provider.translate({ ...base });
    for (const term of base.preserveTerms) {
      expect(result.value.translatedText).toContain(term);
    }
    expect(result.value.preservedTerms.length).toBeGreaterThan(0);
  });

  it('produces different output for different modes', async () => {
    const xStyle = await provider.translate({ ...base, mode: 'X_STYLE' });
    const professional = await provider.translate({ ...base, mode: 'PROFESSIONAL' });
    const literal = await provider.translate({ ...base, mode: 'LITERAL' });
    expect(xStyle.value.translatedText).not.toBe(professional.value.translatedText);
    expect(literal.value.translatedText).not.toBe(professional.value.translatedText);
  });

  it('keeps fewer terms in English under FULL_ARABIC', async () => {
    const keep = await provider.translate({ ...base, terminologyPreference: 'KEEP_COMMON_ENGLISH_TERMS' });
    const full = await provider.translate({ ...base, terminologyPreference: 'FULL_ARABIC' });
    expect(full.value.preservedTerms.length).toBeLessThanOrEqual(keep.value.preservedTerms.length);
  });
});

describe('MockLlmProvider.classify', () => {
  it('ranks the label that actually overlaps the text first', async () => {
    const result = await provider.classify({
      text: 'We fine-tuned an LLM to build autonomous AI agents that call tools.',
      labels: ['AI', 'Cooking', 'Real Estate'],
    });
    expect(result.value.label).toBe('AI');
    expect(result.value.confidence).toBeGreaterThan(0);
    expect(result.value.confidence).toBeLessThanOrEqual(1);
  });

  it('reports matching candidates with a bounded confidence, strongest first', async () => {
    const result = await provider.classify({
      text: 'Our SaaS product uses AI agents to automate sales outreach.',
      labels: ['AI', 'SaaS', 'Real Estate'],
    });

    expect(result.value.matchedLabels.length).toBeGreaterThan(0);
    for (const match of result.value.matchedLabels) {
      expect(match.confidence).toBeGreaterThan(0);
      expect(match.confidence).toBeLessThanOrEqual(1);
    }

    const confidences = result.value.matchedLabels.map((match) => match.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);

    // Labels with no overlap are omitted rather than reported at zero, so a
    // caller can treat the list as "what this text is actually about".
    expect(result.value.matchedLabels.map((match) => match.label)).not.toContain('Real Estate');
  });

  it('falls back to the unclassified label when nothing overlaps', async () => {
    const result = await provider.classify({
      text: 'zzzz qqqq wwww',
      labels: ['AI', 'SaaS'],
    });
    expect(result.value.label).toBe(UNCLASSIFIED_LABEL);
  });

  it('is deterministic', async () => {
    const request = { text: 'AI agents and RAG pipelines', labels: ['AI', 'SaaS'] } as const;
    const first = await provider.classify(request);
    const second = await provider.classify(request);
    expect(first.value).toStrictEqual(second.value);
  });
});

describe('MockLlmProvider.summarize', () => {
  const text = [
    'OpenAI released a new agent framework this morning.',
    'The framework includes a scheduler, a memory store and a tool registry.',
    'Early users say it removes most of the glue code they were writing by hand.',
    'Pricing has not been announced yet.',
  ].join(' ');

  it('respects the sentence budget', async () => {
    const result = await provider.summarize({ text, language: 'EN', maxSentences: 2 });
    const sentences = result.value.split(/(?<=[.!?])\s+/u).filter((part) => part.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });

  it('returns content drawn from the source', async () => {
    const result = await provider.summarize({ text, language: 'EN', maxSentences: 2 });
    expect(result.value.length).toBeGreaterThan(20);
    expect(result.value.toLowerCase()).toContain('framework');
  });

  it('is deterministic', async () => {
    const request = { text, language: 'EN', maxSentences: 2 } as const;
    expect((await provider.summarize(request)).value).toBe(
      (await provider.summarize(request)).value,
    );
  });
});

describe('MockLlmProvider.embed', () => {
  it('returns unit vectors of the configured width', async () => {
    const result = await provider.embed({ texts: ['openai agent framework'] });
    expect(result.value.dimensions).toBe(768);
    const vector = result.value.vectors[0];
    expect(vector).toBeDefined();
    if (vector === undefined) return;
    expect(vector).toHaveLength(768);
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    const first = await provider.embed({ texts: ['agents'] });
    const second = await provider.embed({ texts: ['agents'] });
    expect(first.value.vectors).toStrictEqual(second.value.vectors);
  });

  it('scores related text higher than unrelated text', async () => {
    // Clustering and semantic search are both built on this property, so it is
    // a contract of the offline provider rather than an incidental behaviour.
    const result = await provider.embed({
      texts: [
        'OpenAI releases a new agent framework for developers',
        'Thoughts about the new OpenAI agent framework?',
        'Sourdough bread proofing times in a cold kitchen',
      ],
    });
    const [a, b, c] = result.value.vectors;
    expect(a && b && c).toBeTruthy();
    if (!a || !b || !c) return;

    const dot = (x: readonly number[], y: readonly number[]) =>
      x.reduce((total, value, index) => total + value * (y[index] ?? 0), 0);

    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });

  it('embeds Arabic text without collapsing to zero', async () => {
    const result = await provider.embed({ texts: ['إطار عمل جديد لوكلاء الذكاء الاصطناعي'] });
    const vector = result.value.vectors[0];
    expect(vector).toBeDefined();
    if (vector === undefined) return;
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('returns one vector per input, in order', async () => {
    const result = await provider.embed({ texts: ['alpha', 'beta', 'gamma'] });
    expect(result.value.vectors).toHaveLength(3);
  });
});
