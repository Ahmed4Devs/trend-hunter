import { EMBEDDING_DIMENSIONS } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  cosineDistanceToSimilarity,
  embedTextDeterministically,
  fromPgVectorLiteral,
  similarityToCosineDistance,
  toPgVectorLiteral,
  topKBySimilarity,
  VectorDimensionError,
  VectorLiteralError,
} from '../src/index';

describe('toPgVectorLiteral', () => {
  it('renders the pgvector text form', () => {
    expect(toPgVectorLiteral([0.5, -0.25, 1], 3)).toBe('[0.5,-0.25,1]');
  });

  it('normalises negative zero', () => {
    expect(toPgVectorLiteral([-0, 0], 2)).toBe('[0,0]');
  });

  it('rejects a vector of the wrong width', () => {
    expect(() => toPgVectorLiteral([0.1, 0.2], 3)).toThrow(VectorDimensionError);
    expect(() => toPgVectorLiteral([0.1, 0.2, 0.3, 0.4], 3)).toThrow(VectorDimensionError);
  });

  it('defaults to the platform width', () => {
    expect(() => toPgVectorLiteral([1, 2, 3])).toThrow(VectorDimensionError);
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    expect(toPgVectorLiteral(vector)).toContain(',');
  });

  it('refuses a non-finite component before it reaches the column', () => {
    expect(() => toPgVectorLiteral([1, Number.NaN, 3], 3)).toThrow(VectorLiteralError);
    expect(() => toPgVectorLiteral([1, Number.POSITIVE_INFINITY, 3], 3)).toThrow(
      VectorLiteralError,
    );
  });
});

describe('fromPgVectorLiteral', () => {
  it('round-trips a real embedding', () => {
    const vector = embedTextDeterministically('open source language models');
    const parsed = fromPgVectorLiteral(toPgVectorLiteral(vector));

    expect(parsed).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(parsed).toEqual(vector);
  });

  it('accepts whitespace around the literal and its components', () => {
    expect(fromPgVectorLiteral('  [ 0.5 , -0.25 , 1 ] ', 3)).toEqual([0.5, -0.25, 1]);
  });

  it('accepts scientific notation, which pgvector emits for small values', () => {
    expect(fromPgVectorLiteral('[1e-7,2]', 2)).toEqual([1e-7, 2]);
  });

  it('rejects an unbracketed literal', () => {
    expect(() => fromPgVectorLiteral('0.5,0.25', 2)).toThrow(VectorLiteralError);
  });

  it('rejects a non-numeric or empty component', () => {
    expect(() => fromPgVectorLiteral('[0.5,abc]', 2)).toThrow(VectorLiteralError);
    expect(() => fromPgVectorLiteral('[0.5,]', 2)).toThrow(VectorLiteralError);
    expect(() => fromPgVectorLiteral('[0.5,NaN]', 2)).toThrow(VectorLiteralError);
  });

  it('rejects a literal of the wrong width', () => {
    expect(() => fromPgVectorLiteral('[0.5,0.25]', 3)).toThrow(VectorDimensionError);
    expect(() => fromPgVectorLiteral('[]', 3)).toThrow(VectorDimensionError);
  });
});

describe('cosineDistanceToSimilarity', () => {
  it('maps the distance range onto 0..1', () => {
    expect(cosineDistanceToSimilarity(0)).toBe(1);
    expect(cosineDistanceToSimilarity(0.25)).toBeCloseTo(0.75, 10);
    expect(cosineDistanceToSimilarity(1)).toBe(0);
  });

  it('clamps distances beyond an orthogonal pair to 0', () => {
    expect(cosineDistanceToSimilarity(1.5)).toBe(0);
    expect(cosineDistanceToSimilarity(2)).toBe(0);
  });

  it('never returns a non-finite similarity', () => {
    expect(cosineDistanceToSimilarity(Number.NaN)).toBe(0);
    expect(cosineDistanceToSimilarity(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('round-trips through similarityToCosineDistance', () => {
    for (const similarity of [0, 0.25, 0.5, 0.75, 1]) {
      expect(cosineDistanceToSimilarity(similarityToCosineDistance(similarity))).toBeCloseTo(
        similarity,
        10,
      );
    }
    expect(similarityToCosineDistance(1.4)).toBe(0);
  });
});

describe('topKBySimilarity', () => {
  const query = [1, 0, 0];
  const candidates = [
    { item: 'orthogonal', vector: [0, 1, 0] },
    { item: 'exact', vector: [1, 0, 0] },
    { item: 'close', vector: [0.9, 0.1, 0] },
    { item: 'opposite', vector: [-1, 0, 0] },
  ];

  it('orders candidates by descending similarity', () => {
    const top = topKBySimilarity(query, candidates, 3);
    expect(top.map((entry) => entry.item)).toEqual(['exact', 'close', 'orthogonal']);
    expect(top[0]?.similarity).toBeCloseTo(1, 10);
  });

  it('returns every candidate when k exceeds the pool', () => {
    expect(topKBySimilarity(query, candidates, 100)).toHaveLength(4);
  });

  it('returns nothing for a non-positive k or an empty query', () => {
    expect(topKBySimilarity(query, candidates, 0)).toEqual([]);
    expect(topKBySimilarity(query, candidates, -3)).toEqual([]);
    expect(topKBySimilarity([], candidates, 3)).toEqual([]);
  });

  it('applies a similarity floor', () => {
    const top = topKBySimilarity(query, candidates, 10, { minSimilarity: 0.5 });
    expect(top.map((entry) => entry.item)).toEqual(['exact', 'close']);
  });

  it('skips candidates produced by a different model width', () => {
    const top = topKBySimilarity(query, [...candidates, { item: 'stale', vector: [1, 0] }], 10);
    expect(top.map((entry) => entry.item)).not.toContain('stale');
  });

  it('keeps input order for ties', () => {
    const tied = [
      { item: 'first', vector: [1, 0, 0] },
      { item: 'second', vector: [2, 0, 0] },
      { item: 'third', vector: [3, 0, 0] },
    ];
    expect(topKBySimilarity(query, tied, 3).map((entry) => entry.item)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('ranks a real embedding against a pool of texts', () => {
    const pool = [
      'وصفة القهوة العربية بالهيل',
      'الذكاء الاصطناعي في الشركات الناشئة العربية',
      'football transfer news and rumours',
    ].map((text) => ({ item: text, vector: embedTextDeterministically(text) }));

    const top = topKBySimilarity(
      embedTextDeterministically('الشركات الناشئة العربية والذكاء الاصطناعي'),
      pool,
      1,
    );

    expect(top[0]?.item).toBe('الذكاء الاصطناعي في الشركات الناشئة العربية');
  });
});
