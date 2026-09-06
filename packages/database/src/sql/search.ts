import { SEARCH_CANDIDATE_POOL } from '@trendhunter/shared';
import type { ContentLanguage, SearchEntityKind, SourceKind } from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { Prisma } from '../client';
import { toVectorLiteral } from './vector';

/**
 * Full-text, semantic and hybrid search.
 *
 * Three deliberate choices here:
 *
 *  * `websearch_to_tsquery` is the only tsquery parser that never raises a
 *    syntax error, so a user can type `"quoted phrase" -excluded or this` — or
 *    an unbalanced quote — and get a result instead of a 500.
 *  * `ts_rank_cd` rather than `ts_rank`: cover-density ranking accounts for how
 *    close the matching lexemes are to each other, which is what makes
 *    multi-word queries rank sensibly. Normalisation flag 32 squashes the score
 *    into 0..1 so it is comparable across queries.
 *  * Hybrid search fuses by RANK POSITION (Reciprocal Rank Fusion), never by
 *    raw score. Cosine distance lives in 0..2 while `ts_rank_cd` is unbounded;
 *    normalising them against each other would need per-corpus tuning that
 *    would silently rot. RRF needs none.
 */

/**
 * PostgreSQL text search configurations, selected by a whitelist lookup. The
 * value is bound as a parameter and cast to `regconfig`, so an unknown name
 * would be a clean PostgreSQL error rather than an injection — but it can never
 * be unknown, because it is only ever read out of this object.
 */
const TEXT_SEARCH_CONFIG: Readonly<Record<ContentLanguage, string>> = {
  EN: 'english',
  AR: 'arabic',
  OTHER: 'simple',
};

/** RRF smoothing constant. 60 is the value from the original RRF paper. */
const RRF_K = 60;

/**
 * pgvector's own ceiling on `hnsw.ef_search`.
 *
 * Not advisory: PostgreSQL raises `1004 is outside the valid range for
 * parameter "hnsw.ef_search" (1 .. 1000)` and the whole search fails. Deep
 * pagination pushes the derived value past it — a page size of 20 reaches it
 * around page 13 — so every derived value is clamped here as well as being
 * bounded by the page limit at the request boundary. Recall degrades past this
 * depth; an exception would be worse.
 */
const MAX_EF_SEARCH = 1000;

export interface SearchFilters {
  readonly sources?: readonly SourceKind[];
  readonly languages?: readonly ContentLanguage[];
  readonly topicId?: string;
  readonly publishedFrom?: Date;
  readonly publishedTo?: Date;
  readonly minRelevance?: number;
  readonly includeHidden?: boolean;
}

export interface SearchHit {
  readonly id: string;
  readonly entity: SearchEntityKind;
  /** 0..1 fused score, comparable only within one result set. */
  readonly score: number;
  /** Rank in the keyword arm, or null when it did not appear there. */
  readonly keywordRank: number | null;
  /** Rank in the semantic arm, or null when it did not appear there. */
  readonly semanticRank: number | null;
  readonly headline: string | null;
}

/** Builds the shared WHERE fragment for the posts table. */
function postFilterFragment(filters: SearchFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  if (filters.includeHidden !== true) {
    clauses.push(Prisma.sql`AND p."is_hidden" = false`);
  }
  if (filters.sources && filters.sources.length > 0) {
    clauses.push(
      Prisma.sql`AND p."source"::text IN (${Prisma.join(filters.sources.map((s) => s))})`,
    );
  }
  if (filters.languages && filters.languages.length > 0) {
    clauses.push(
      Prisma.sql`AND p."language"::text IN (${Prisma.join(filters.languages.map((l) => l))})`,
    );
  }
  if (filters.topicId !== undefined) {
    clauses.push(Prisma.sql`AND p."topic_id" = ${filters.topicId}`);
  }
  if (filters.publishedFrom !== undefined) {
    clauses.push(Prisma.sql`AND p."published_at" >= ${filters.publishedFrom}`);
  }
  if (filters.publishedTo !== undefined) {
    clauses.push(Prisma.sql`AND p."published_at" <= ${filters.publishedTo}`);
  }
  if (filters.minRelevance !== undefined) {
    clauses.push(Prisma.sql`AND p."relevance_score" >= ${filters.minRelevance}`);
  }

  return clauses.length === 0 ? Prisma.empty : Prisma.join(clauses, ' ');
}

export interface KeywordSearchOptions {
  readonly query: string;
  readonly language: ContentLanguage;
  readonly limit: number;
  readonly offset?: number;
  readonly filters?: SearchFilters;
  readonly withHeadline?: boolean;
}

/** Full-text search over posts. */
export async function keywordSearchPosts(
  client: PrismaClient,
  options: KeywordSearchOptions,
): Promise<SearchHit[]> {
  const config = TEXT_SEARCH_CONFIG[options.language];
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const filters = postFilterFragment(options.filters ?? {});

  // ts_headline re-parses the document, so it only ever runs on the rows that
  // survived LIMIT — never on the whole candidate set.
  const headline = options.withHeadline
    ? Prisma.sql`ts_headline(
        ${config}::regconfig,
        left(p."content", 2000),
        q.tsq,
        'StartSel=<<,StopSel=>>,MaxFragments=2,MinWords=8,MaxWords=28,FragmentDelimiter= … '
      )`
    : Prisma.sql`NULL`;

  const rows = await client.$queryRaw<{ id: string; rank: number; headline: string | null }[]>`
    WITH q AS (SELECT websearch_to_tsquery(${config}::regconfig, ${options.query}) AS tsq)
    SELECT p."id" AS "id",
           ts_rank_cd('{0.1,0.2,0.4,1.0}'::float4[], p."search_vector", q.tsq, 32)::float8 AS "rank",
           ${headline} AS "headline"
    FROM "posts" p, q
    WHERE p."search_vector" @@ q.tsq
      ${filters}
    ORDER BY "rank" DESC, p."published_at" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return rows.map((row, index) => ({
    id: row.id,
    entity: 'post' as const,
    score: row.rank,
    keywordRank: index + 1 + offset,
    semanticRank: null,
    headline: row.headline,
  }));
}

export interface SemanticSearchOptions {
  readonly embedding: readonly number[];
  readonly limit: number;
  readonly offset?: number;
  readonly filters?: SearchFilters;
  readonly efSearch?: number;
}

/** Vector search over posts, using the HNSW index. */
export async function semanticSearchPosts(
  client: PrismaClient,
  options: SemanticSearchOptions,
): Promise<SearchHit[]> {
  const literal = toVectorLiteral(options.embedding);
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const efSearch = Math.min(
    MAX_EF_SEARCH,
    Math.max(limit + offset, options.efSearch ?? (limit + offset) * 4),
  );
  const filters = postFilterFragment(options.filters ?? {});

  const rows = await client.$transaction(async (tx) => {
    // HNSW applies filters after the index scan, so a selective WHERE can
    // return fewer rows than requested. strict_order keeps scanning until the
    // limit is satisfied, without disturbing distance ordering.
    await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(efSearch)}, true)`;
    await tx.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`;
    return tx.$queryRaw<{ id: string; distance: number }[]>`
      SELECT p."id" AS "id",
             (p."embedding" <=> ${literal}::vector)::float8 AS "distance"
      FROM "posts" p
      WHERE p."embedding" IS NOT NULL
        ${filters}
      ORDER BY p."embedding" <=> ${literal}::vector
      LIMIT ${limit} OFFSET ${offset}
    `;
  });

  return rows.map((row, index) => ({
    id: row.id,
    entity: 'post' as const,
    score: Math.max(0, (2 - row.distance) / 2),
    keywordRank: null,
    semanticRank: index + 1 + offset,
    headline: null,
  }));
}

export interface HybridSearchOptions {
  readonly query: string;
  readonly embedding: readonly number[];
  readonly language: ContentLanguage;
  readonly limit: number;
  readonly offset?: number;
  readonly filters?: SearchFilters;
  /** Candidates drawn from each arm before fusion. More gives RRF more signal. */
  readonly candidatePool?: number;
}

/**
 * Hybrid search: one statement, two candidate sets, fused by Reciprocal Rank
 * Fusion.
 *
 * Each arm over-fetches `candidatePool` rows so that a document ranked poorly
 * by one arm and well by the other still surfaces. A row present in both arms
 * accumulates both reciprocal ranks, which is what makes the fusion prefer
 * documents that satisfy the query in more than one way.
 */
export async function hybridSearchPosts(
  client: PrismaClient,
  options: HybridSearchOptions,
): Promise<SearchHit[]> {
  const config = TEXT_SEARCH_CONFIG[options.language];
  const literal = toVectorLiteral(options.embedding);
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const pool = Math.max(
    limit + offset,
    Math.min(500, options.candidatePool ?? SEARCH_CANDIDATE_POOL),
  );
  const filters = postFilterFragment(options.filters ?? {});

  const efSearch = Math.min(MAX_EF_SEARCH, pool * 2);

  const rows = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(efSearch)}, true)`;
    await tx.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`;
    return tx.$queryRaw<
      {
        id: string;
        score: number;
        keyword_rank: number | null;
        semantic_rank: number | null;
      }[]
    >`
      WITH q AS (
        SELECT websearch_to_tsquery(${config}::regconfig, ${options.query}) AS tsq
      ),
      keyword AS (
        SELECT p."id" AS id,
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank_cd('{0.1,0.2,0.4,1.0}'::float4[], p."search_vector", q.tsq, 32) DESC,
                          p."published_at" DESC
               ) AS rank
        FROM "posts" p, q
        WHERE p."search_vector" @@ q.tsq
          ${filters}
        -- Repeated from the window's own ORDER BY. Without it the LIMIT keeps
        -- an arbitrary subset of the matches and only those are ranked, so the
        -- fusion sees the wrong candidates. It happens to work while the
        -- planner sorts for the WindowAgg anyway, which is not a guarantee.
        ORDER BY ts_rank_cd('{0.1,0.2,0.4,1.0}'::float4[], p."search_vector", q.tsq, 32) DESC,
                 p."published_at" DESC
        LIMIT ${pool}
      ),
      semantic AS (
        SELECT p."id" AS id,
               ROW_NUMBER() OVER (ORDER BY p."embedding" <=> ${literal}::vector) AS rank
        FROM "posts" p
        WHERE p."embedding" IS NOT NULL
          ${filters}
        ORDER BY p."embedding" <=> ${literal}::vector
        LIMIT ${pool}
      ),
      fused AS (
        SELECT COALESCE(k.id, s.id) AS id,
               k.rank AS keyword_rank,
               s.rank AS semantic_rank,
               COALESCE(1.0 / (${RRF_K} + k.rank), 0.0)
             + COALESCE(1.0 / (${RRF_K} + s.rank), 0.0) AS score
        FROM keyword k
        FULL OUTER JOIN semantic s ON s.id = k.id
      )
      SELECT id,
             score::float8 AS "score",
             keyword_rank::int AS "keyword_rank",
             semantic_rank::int AS "semantic_rank"
      FROM fused
      ORDER BY score DESC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  });

  return rows.map((row) => ({
    id: row.id,
    entity: 'post' as const,
    score: row.score,
    keywordRank: row.keyword_rank,
    semanticRank: row.semantic_rank,
    headline: null,
  }));
}

/** Full-text search over topics. */
export async function keywordSearchTopics(
  client: PrismaClient,
  options: { query: string; language: ContentLanguage; limit: number; offset?: number },
): Promise<SearchHit[]> {
  const config = TEXT_SEARCH_CONFIG[options.language];
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const rows = await client.$queryRaw<{ id: string; rank: number }[]>`
    WITH q AS (SELECT websearch_to_tsquery(${config}::regconfig, ${options.query}) AS tsq)
    SELECT t."id" AS "id",
           ts_rank_cd('{0.1,0.2,0.4,1.0}'::float4[], t."search_vector", q.tsq, 32)::float8 AS "rank"
    FROM "topics" t, q
    WHERE t."search_vector" @@ q.tsq
      AND t."status" = 'ACTIVE'
    ORDER BY "rank" DESC, t."trend_score" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return rows.map((row, index) => ({
    id: row.id,
    entity: 'topic' as const,
    score: row.rank,
    keywordRank: index + 1 + offset,
    semanticRank: null,
    headline: null,
  }));
}

/** Full-text search over comments. */
export async function keywordSearchComments(
  client: PrismaClient,
  options: { query: string; language: ContentLanguage; limit: number; offset?: number },
): Promise<SearchHit[]> {
  const config = TEXT_SEARCH_CONFIG[options.language];
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const rows = await client.$queryRaw<{ id: string; rank: number }[]>`
    WITH q AS (SELECT websearch_to_tsquery(${config}::regconfig, ${options.query}) AS tsq)
    SELECT c."id" AS "id",
           ts_rank_cd(c."search_vector", q.tsq, 32)::float8 AS "rank"
    FROM "comments" c, q
    WHERE c."search_vector" @@ q.tsq
    ORDER BY "rank" DESC, c."published_at" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return rows.map((row, index) => ({
    id: row.id,
    entity: 'comment' as const,
    score: row.rank,
    keywordRank: index + 1 + offset,
    semanticRank: null,
    headline: null,
  }));
}

/**
 * Trigram-backed suggestions for the search box.
 *
 * Full-text search matches whole lexemes, so it cannot answer a half-typed
 * word; this is what makes the suggestion dropdown respond from the first few
 * characters.
 */
export async function suggestSearchTerms(
  client: PrismaClient,
  options: { prefix: string; limit: number },
): Promise<{ value: string; kind: 'topic' | 'author' }[]> {
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit)));
  const prefix = options.prefix.trim();
  if (prefix.length === 0) return [];

  return client.$queryRaw<{ value: string; kind: 'topic' | 'author' }[]>`
    (
      SELECT t."name" AS "value", 'topic' AS "kind", similarity(t."name", ${prefix}) AS sim
      FROM "topics" t
      WHERE t."status" = 'ACTIVE' AND t."name" % ${prefix}
      ORDER BY sim DESC, t."trend_score" DESC
      LIMIT ${limit}
    )
    UNION ALL
    (
      SELECT DISTINCT ON (p."author_username")
             p."author_username" AS "value", 'author' AS "kind",
             similarity(p."author_username", ${prefix}) AS sim
      FROM "posts" p
      WHERE p."author_username" IS NOT NULL AND p."author_username" % ${prefix}
      ORDER BY p."author_username", sim DESC
      LIMIT ${limit}
    )
    ORDER BY sim DESC
    LIMIT ${limit}
  `;
}
