import { cosineSimilarity, EMBEDDING_DIMENSIONS } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  DETERMINISTIC_EMBEDDING_MODEL,
  DeterministicEmbeddingProvider,
  embedTextDeterministically,
} from '../src/index';

const ENGLISH = 'OpenAI released a new large language model aimed at developers';
const ENGLISH_RELATED = 'A new large language model from OpenAI is aimed at developers everywhere';
const ENGLISH_UNRELATED = 'The football match ended with a late penalty during extra time';

const ARABIC = 'الذكاء الاصطناعي يغير طريقة عمل الشركات الناشئة في المنطقة العربية';
const ARABIC_RELATED = 'الشركات الناشئة في المنطقة العربية تستخدم الذكاء الاصطناعي في عملها';
const ARABIC_UNRELATED = 'طريقة تحضير القهوة بالهيل والزعفران في المنزل خطوة بخطوة';

function norm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

describe('embedTextDeterministically', () => {
  it('is deterministic for the same input', () => {
    expect(embedTextDeterministically(ENGLISH)).toEqual(embedTextDeterministically(ENGLISH));
  });

  it('produces a unit vector of the platform width', () => {
    const vector = embedTextDeterministically(ENGLISH);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(norm(vector)).toBeCloseTo(1, 10);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('honours a custom width', () => {
    const vector = embedTextDeterministically(ENGLISH, 64);
    expect(vector).toHaveLength(64);
    expect(norm(vector)).toBeCloseTo(1, 10);
  });

  it('never returns a zero vector, even for empty or symbol-only input', () => {
    for (const text of ['', '   ', '!!!', '\n\t']) {
      const vector = embedTextDeterministically(text);
      expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(norm(vector)).toBeCloseTo(1, 10);
    }
  });

  it('distinguishes texts that differ only in a single token', () => {
    expect(embedTextDeterministically('open source model')).not.toEqual(
      embedTextDeterministically('open source dataset'),
    );
  });

  it('ranks overlapping English text above unrelated English text', () => {
    const query = embedTextDeterministically(ENGLISH);
    const related = cosineSimilarity(query, embedTextDeterministically(ENGLISH_RELATED));
    const unrelated = cosineSimilarity(query, embedTextDeterministically(ENGLISH_UNRELATED));

    expect(related).toBeGreaterThan(0.3);
    expect(related).toBeGreaterThan(unrelated);
    expect(Math.abs(unrelated)).toBeLessThan(0.2);
  });

  it('ranks overlapping Arabic text above unrelated Arabic text', () => {
    const query = embedTextDeterministically(ARABIC);
    const related = cosineSimilarity(query, embedTextDeterministically(ARABIC_RELATED));
    const unrelated = cosineSimilarity(query, embedTextDeterministically(ARABIC_UNRELATED));

    expect(related).toBeGreaterThan(0.3);
    expect(related).toBeGreaterThan(unrelated);
  });

  it('scores a text against itself at 1', () => {
    const vector = embedTextDeterministically(ARABIC);
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1, 10);
  });

  it('places Arabic and English texts on unrelated subjects far apart', () => {
    const similarity = cosineSimilarity(
      embedTextDeterministically(ARABIC_UNRELATED),
      embedTextDeterministically(ENGLISH_UNRELATED),
    );
    expect(Math.abs(similarity)).toBeLessThan(0.2);
  });

  it('does not lock a component sign to its index parity', () => {
    // Regression: when the index and the sign are cut from the same hash bit,
    // every even component comes out non-negative and every odd one
    // non-positive, so colliding features add instead of cancelling.
    const vector = embedTextDeterministically(ENGLISH + ' ' + ARABIC);
    expect(vector.some((value, index) => index % 2 === 0 && value < 0)).toBe(true);
    expect(vector.some((value, index) => index % 2 === 1 && value > 0)).toBe(true);
  });

  it('keeps unrelated texts near zero at a narrow width, where collisions are common', () => {
    // The widths are configurable, so the cancellation has to hold when the
    // buckets are crowded — a shared sign pattern would score this pair ~0.3.
    const similarity = cosineSimilarity(
      embedTextDeterministically(ENGLISH_UNRELATED, 64),
      embedTextDeterministically(ARABIC_UNRELATED, 64),
    );
    expect(Math.abs(similarity)).toBeLessThan(0.15);
  });

  it('is insensitive to case and to surrounding whitespace', () => {
    expect(embedTextDeterministically('  Large Language Model  ')).toEqual(
      embedTextDeterministically('large language model'),
    );
  });

  it('weights a repeated token sublinearly rather than linearly', () => {
    const once = embedTextDeterministically('model');
    const many = embedTextDeterministically('model model model model model model model model');
    expect(cosineSimilarity(once, many)).toBeGreaterThan(0.8);

    // With linear term frequency the four repetitions would swamp `dataset`
    // and pull this pair below 0.8; sublinear weighting keeps them close.
    const repetitive = embedTextDeterministically('model model model model dataset');
    const balanced = embedTextDeterministically('model dataset');
    expect(cosineSimilarity(repetitive, balanced)).toBeGreaterThan(0.8);
  });
});

describe('DeterministicEmbeddingProvider', () => {
  it('embeds a batch and reports its own width', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const result = await provider.embed({ texts: [ENGLISH, ARABIC] });

    expect(provider.name).toBe('deterministic');
    expect(provider.model).toBe(DETERMINISTIC_EMBEDDING_MODEL);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(result.value.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(result.value.vectors).toHaveLength(2);
    expect(result.value.vectors[0]).toEqual(embedTextDeterministically(ENGLISH));
    expect(result.value.vectors[1]).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('costs nothing and reports a non-zero prompt usage', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const result = await provider.embed({ texts: [ENGLISH] });

    expect(result.meta.usage.estimatedCost).toBe(0);
    expect(result.meta.usage.promptTokens).toBeGreaterThan(0);
    expect(result.meta.usage.totalTokens).toBe(result.meta.usage.promptTokens);
    expect(result.meta.provider).toBe('deterministic');
  });

  it('answers an empty batch with an empty result', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const result = await provider.embed({ texts: [] });
    expect(result.value.vectors).toEqual([]);
  });

  it('respects a configured width and model name', async () => {
    const provider = new DeterministicEmbeddingProvider({ dimensions: 128, model: 'custom-v2' });
    const result = await provider.embed({ texts: [ARABIC] });

    expect(provider.dimensions).toBe(128);
    expect(result.value.model).toBe('custom-v2');
    expect(result.value.vectors[0]).toHaveLength(128);
  });
});
