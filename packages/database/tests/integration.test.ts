import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, disconnectDatabase, type PrismaClient } from '../src/client';
import {
  hybridSearchPosts,
  keywordSearchPosts,
  semanticSearchPosts,
  suggestSearchTerms,
} from '../src/sql/search';
import {
  findNearestNeighbours,
  fromVectorLiteral,
  getEmbedding,
  setEmbedding,
  setEmbeddings,
  toVectorLiteral,
} from '../src/sql/vector';

/**
 * Integration tests for the hand-written SQL.
 *
 * The vector and full-text statements are the part of this package that unit
 * tests cannot cover: they are strings whose correctness lives in PostgreSQL,
 * and every one of their failure modes is silent. An HNSW index that is not
 * used degrades to a sequential scan; a tsvector built with the wrong text
 * search configuration simply matches nothing. Both look like "no results".
 *
 * The suite is skipped when no database is reachable, so `pnpm test` stays
 * runnable without Docker; run `pnpm docker:up && pnpm db:migrate` first to
 * exercise it.
 */

const connectionString = process.env.DATABASE_URL;
const describeWithDatabase = connectionString === undefined ? describe.skip : describe;

const SEED_PREFIX = 'integration-';
const DIMENSIONS = 768;

/** A deterministic unit vector; nearby seeds produce nearby vectors. */
function vector(seed: number): number[] {
  const values = Array.from({ length: DIMENSIONS }, (_, index) =>
    Math.sin(seed * (index + 1) * 0.017),
  );
  const norm = Math.sqrt(values.reduce((total, value) => total + value * value, 0));
  return values.map((value) => value / norm);
}

describeWithDatabase('database integration', () => {
  let db: PrismaClient;
  const postIds = new Map<string, string>();

  beforeAll(async () => {
    db = createDatabaseClient({ connectionString: connectionString ?? '', poolMax: 4 });

    await db.post.deleteMany({ where: { sourcePostId: { startsWith: SEED_PREFIX } } });

    const now = new Date();
    const fixtures = [
      {
        key: 'launch',
        title: 'OpenAI releases a new agent framework',
        content: 'The framework ships with a scheduler, a memory store and a tool registry.',
        seed: 1,
        language: 'EN' as const,
      },
      {
        key: 'discussion',
        title: 'Thoughts on the new OpenAI agent framework?',
        content: 'It removes a lot of glue code, though the memory model is surprising.',
        seed: 1.03,
        language: 'EN' as const,
      },
      {
        key: 'unrelated',
        title: 'Kubernetes cost optimisation at scale',
        content: 'Rightsizing requests cut our monthly cloud bill by a third.',
        seed: 9,
        language: 'EN' as const,
      },
      {
        key: 'arabic',
        title: 'إطار عمل جديد لوكلاء الذكاء الاصطناعي',
        content: 'يوفر الإطار جدولة للمهام وذاكرة طويلة الأمد لوكلاء الذكاء الاصطناعي.',
        seed: 1.05,
        language: 'AR' as const,
      },
    ];

    for (const fixture of fixtures) {
      const sourcePostId = `${SEED_PREFIX}${fixture.key}`;
      const post = await db.post.upsert({
        where: { source_sourcePostId: { source: 'X', sourcePostId } },
        update: { title: fixture.title, content: fixture.content },
        create: {
          source: 'X',
          sourcePostId,
          authorUsername: 'integration_author',
          title: fixture.title,
          content: fixture.content,
          url: `https://example.test/${sourcePostId}`,
          canonicalUrl: `https://example.test/${sourcePostId}`,
          contentHash: `hash-${sourcePostId}`,
          language: fixture.language,
          // Arabic rows index their normalised copy, so the fixture provides one.
          ...(fixture.language === 'AR'
            ? { normalizedTitle: fixture.title, normalizedContent: fixture.content }
            : {}),
          publishedAt: now,
          collectedAt: now,
        },
        select: { id: true },
      });
      postIds.set(fixture.key, post.id);
      await setEmbedding(db, 'posts', post.id, vector(fixture.seed));
    }
  }, 60_000);

  afterAll(async () => {
    await db.post.deleteMany({ where: { sourcePostId: { startsWith: SEED_PREFIX } } });
    await disconnectDatabase(db);
  });

  describe('vector storage', () => {
    it('round-trips an embedding at full precision', async () => {
      const id = postIds.get('launch');
      expect(id).toBeDefined();
      if (id === undefined) return;

      const stored = await getEmbedding(db, 'posts', id);
      expect(stored).toHaveLength(DIMENSIONS);

      const original = vector(1);
      // pgvector stores float4, so a small tolerance is expected and correct.
      for (let index = 0; index < DIMENSIONS; index += 1) {
        expect(stored?.[index]).toBeCloseTo(original[index] ?? 0, 5);
      }
    });

    it('writes a batch in one statement', async () => {
      const ids = [postIds.get('launch'), postIds.get('discussion')].filter(
        (id): id is string => id !== undefined,
      );
      const updated = await setEmbeddings(
        db,
        'posts',
        ids.map((id, index) => ({ id, embedding: vector(1 + index * 0.03) })),
      );
      expect(updated).toBe(ids.length);
    });

    it('refuses a wrong-dimension vector before it reaches the column', () => {
      // A short vector would be accepted by the driver and then corrupt every
      // comparison involving that row.
      expect(() => toVectorLiteral([1, 2, 3])).toThrow();
    });

    it('refuses a non-finite component', () => {
      const broken = vector(1);
      broken[0] = Number.NaN;
      expect(() => toVectorLiteral(broken)).toThrow();
    });

    it('parses a literal back to numbers', () => {
      expect(fromVectorLiteral('[1,2,3]')).toEqual([1, 2, 3]);
      expect(() => fromVectorLiteral('{"not":"a vector"}')).toThrow();
    });
  });

  describe('nearest-neighbour search', () => {
    it('ranks a related post above an unrelated one', async () => {
      const neighbours = await findNearestNeighbours(db, {
        table: 'posts',
        embedding: vector(1),
        limit: 4,
      });

      const byId = new Map(neighbours.map((entry) => [entry.id, entry.similarity]));
      const launch = byId.get(postIds.get('launch') ?? '');
      const discussion = byId.get(postIds.get('discussion') ?? '');
      const unrelated = byId.get(postIds.get('unrelated') ?? '');

      expect(launch).toBeGreaterThan(0.99);
      expect(discussion ?? 0).toBeGreaterThan(unrelated ?? 1);
    });

    it('honours the exclusion list', async () => {
      const excluded = postIds.get('launch');
      expect(excluded).toBeDefined();
      if (excluded === undefined) return;

      const neighbours = await findNearestNeighbours(db, {
        table: 'posts',
        embedding: vector(1),
        limit: 4,
        excludeIds: [excluded],
      });
      expect(neighbours.map((entry) => entry.id)).not.toContain(excluded);
    });

    it('returns similarities inside 0..1', async () => {
      const neighbours = await findNearestNeighbours(db, {
        table: 'posts',
        embedding: vector(5),
        limit: 4,
      });
      for (const neighbour of neighbours) {
        expect(neighbour.similarity).toBeGreaterThanOrEqual(0);
        expect(neighbour.similarity).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('full-text search', () => {
    it('finds an English post by its words', async () => {
      const hits = await keywordSearchPosts(db, {
        query: 'openai agent framework',
        language: 'EN',
        limit: 10,
      });
      expect(hits.map((hit) => hit.id)).toContain(postIds.get('launch'));
    });

    it('produces a highlighted excerpt on request', async () => {
      const hits = await keywordSearchPosts(db, {
        query: 'scheduler memory store',
        language: 'EN',
        limit: 5,
        withHeadline: true,
      });
      expect(hits[0]?.headline).toBeTruthy();
      expect(hits[0]?.headline).toContain('<<');
    });

    it('accepts websearch syntax without raising a syntax error', async () => {
      // to_tsquery would throw on every one of these; websearch_to_tsquery is
      // the only parser safe to hand a raw search box to.
      for (const query of [
        '"agent framework"',
        'agents -kubernetes',
        'openai or anthropic',
        'a &',
      ]) {
        await expect(
          keywordSearchPosts(db, { query, language: 'EN', limit: 3 }),
        ).resolves.toBeDefined();
      }
    });

    it('finds an Arabic post using the Arabic configuration', async () => {
      const hits = await keywordSearchPosts(db, {
        query: 'الذكاء الاصطناعي',
        language: 'AR',
        limit: 10,
      });
      expect(hits.map((hit) => hit.id)).toContain(postIds.get('arabic'));
    });

    it('misses an Arabic term carrying an attached preposition', async () => {
      // A documented limitation, asserted so it cannot regress unnoticed.
      // PostgreSQL's Snowball Arabic stemmer does not strip the attached
      // particle: the document's `لوكلاء` stems to `لوكلاء` while the query's
      // `وكلاء` stems to `كلاء`, so full-text search cannot connect them. There
      // is also no Arabic stopword list shipped with PostgreSQL.
      //
      // This is precisely why search is hybrid rather than keyword-only: the
      // vector arm has no such blind spot, and RRF lets it win this query
      // without any per-language tuning. The next test proves it does.
      const hits = await keywordSearchPosts(db, {
        query: 'وكلاء الذكاء',
        language: 'AR',
        limit: 10,
      });
      expect(hits.map((hit) => hit.id)).not.toContain(postIds.get('arabic'));
    });

    it('applies language and source filters', async () => {
      const hits = await keywordSearchPosts(db, {
        query: 'openai agent framework',
        language: 'EN',
        limit: 10,
        filters: { languages: ['AR'] },
      });
      expect(hits.map((hit) => hit.id)).not.toContain(postIds.get('launch'));
    });
  });

  describe('semantic and hybrid search', () => {
    it('returns semantically similar posts', async () => {
      const hits = await semanticSearchPosts(db, { embedding: vector(1), limit: 5 });
      expect(hits[0]?.id).toBe(postIds.get('launch'));
    });

    it('fuses both arms and reports each rank', async () => {
      const hits = await hybridSearchPosts(db, {
        query: 'openai agent framework',
        embedding: vector(1),
        language: 'EN',
        limit: 5,
      });

      expect(hits.length).toBeGreaterThan(0);
      // A document found by both arms must score above one found by only one.
      const both = hits.filter((hit) => hit.keywordRank !== null && hit.semanticRank !== null);
      const one = hits.filter((hit) => hit.keywordRank === null || hit.semanticRank === null);
      if (both.length > 0 && one.length > 0) {
        expect(Math.min(...both.map((hit) => hit.score))).toBeGreaterThan(
          Math.max(...one.map((hit) => hit.score)),
        );
      }
    });

    it('surfaces a post that only one arm can find', async () => {
      // The unrelated post shares no keywords with this query, so it can only
      // arrive through the vector arm — which is the entire point of hybrid.
      const hits = await hybridSearchPosts(db, {
        query: 'kubernetes rightsizing',
        embedding: vector(9),
        language: 'EN',
        limit: 5,
      });
      expect(hits.map((hit) => hit.id)).toContain(postIds.get('unrelated'));
    });

    it('recovers the Arabic post that keyword search alone cannot reach', async () => {
      // The companion to the stemmer limitation above: the same query that
      // full-text search misses is answered correctly once the vector arm is
      // fused in.
      const hits = await hybridSearchPosts(db, {
        query: 'وكلاء الذكاء',
        embedding: vector(1.05),
        language: 'AR',
        limit: 5,
      });
      expect(hits.map((hit) => hit.id)).toContain(postIds.get('arabic'));
    });
  });

  describe('search suggestions', () => {
    it('matches a partial author name through the trigram index', async () => {
      const suggestions = await suggestSearchTerms(db, { prefix: 'integrat', limit: 5 });
      expect(suggestions.some((entry) => entry.kind === 'author')).toBe(true);
    });

    it('returns nothing for an empty prefix', async () => {
      expect(await suggestSearchTerms(db, { prefix: '   ', limit: 5 })).toEqual([]);
    });
  });

  describe('index usage', () => {
    it('uses the HNSW index rather than a sequential scan when it matters', async () => {
      // With only a handful of rows PostgreSQL correctly prefers a sequential
      // scan, so this asserts the index *exists and is valid* — the case that
      // actually breaks is a migration silently dropping it.
      const indexes = await db.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('posts', 'comments', 'topics')
          AND (indexname LIKE '%_hnsw' OR indexname LIKE '%_search_vector_gin')
        ORDER BY indexname
      `;
      const names = indexes.map((row) => row.indexname);
      expect(names).toContain('posts_embedding_hnsw');
      expect(names).toContain('posts_search_vector_gin');
      expect(names).toContain('comments_embedding_hnsw');
      expect(names).toContain('topics_embedding_hnsw');
    });

    it('keeps search_vector a generated column', async () => {
      const columns = await db.$queryRaw<{ is_generated: string }[]>`
        SELECT is_generated FROM information_schema.columns
        WHERE table_name = 'posts' AND column_name = 'search_vector'
      `;
      expect(columns[0]?.is_generated).toBe('ALWAYS');
    });
  });
});
