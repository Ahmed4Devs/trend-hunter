-- ---------------------------------------------------------------------------
-- Search infrastructure: generated tsvector columns, GIN indexes, trigram
-- indexes and pgvector HNSW indexes.
--
-- None of this is expressible in the Prisma schema language, so the migration
-- is hand-written. `prisma migrate dev` will therefore propose to drop these
-- objects on a future run; `scripts/check-vector-index-drift.mjs` fails the
-- build if a generated migration ever contains such a DROP.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Full-text search vectors
-- ===========================================================================
-- Only the two-argument to_tsvector(regconfig, text) is IMMUTABLE, so the text
-- search configuration has to appear as a literal. A CASE over literals is
-- immutable and lets one column serve both languages without cross-language
-- false positives, because Arabic and English lexemes never collide.
--
-- Arabic rows index the normalised copies (diacritics, tatweel and alef/teh
-- variants folded by the application) so that the query string, normalised the
-- same way, matches. English rows index the raw columns directly.
--
-- Weights: A = title, B = body. ts_rank_cd's default {0.1, 0.2, 0.4, 1.0}
-- weight array then ranks a title hit 2.5x a body hit with no extra work.

ALTER TABLE "posts" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "posts"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    CASE "language"
      WHEN 'AR' THEN
        setweight(to_tsvector('arabic', coalesce("normalized_title", "title", '')), 'A') ||
        setweight(to_tsvector('arabic', coalesce("normalized_content", "content", '')), 'B')
      WHEN 'EN' THEN
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("content", '')), 'B')
      ELSE
        setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("content", '')), 'B')
    END
  ) STORED;

ALTER TABLE "comments" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "comments"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    CASE "language"
      WHEN 'AR' THEN to_tsvector('arabic', coalesce("normalized_content", "content", ''))
      WHEN 'EN' THEN to_tsvector('english', coalesce("content", ''))
      ELSE to_tsvector('simple', coalesce("content", ''))
    END
  ) STORED;

-- Topics carry no language column: their names are English by construction
-- (they are derived from the dominant English discussion) but may hold Arabic
-- summaries, so both configurations are indexed and OR-matched at query time.
ALTER TABLE "topics" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "topics"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('arabic', coalesce("normalized_name", '')), 'A') ||
    setweight(to_tsvector('arabic', coalesce("normalized_summary", '')), 'B')
  ) STORED;

CREATE INDEX "posts_search_vector_gin" ON "posts" USING GIN ("search_vector");
CREATE INDEX "comments_search_vector_gin" ON "comments" USING GIN ("search_vector");
CREATE INDEX "topics_search_vector_gin" ON "topics" USING GIN ("search_vector");

-- ===========================================================================
-- 2. Trigram indexes
-- ===========================================================================
-- Full-text search matches whole lexemes only, so it cannot answer a partial
-- word or a typo. These back the search-suggestion endpoint and the "did you
-- mean" fallback.

CREATE INDEX "posts_title_trgm" ON "posts" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "topics_name_trgm" ON "topics" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "posts_author_username_trgm"
  ON "posts" USING GIN ("author_username" gin_trgm_ops);

-- ===========================================================================
-- 3. pgvector HNSW indexes
-- ===========================================================================
-- Cosine distance (<=>) throughout, so every index uses vector_cosine_ops. The
-- operator class must match the operator used in ORDER BY or the index is
-- silently ignored and the query degrades to a sequential scan.
--
-- m = 16 / ef_construction = 64 are pgvector's defaults and the right starting
-- point at this scale; raise them only against a measured recall target.

SET maintenance_work_mem = '256MB';

CREATE INDEX "posts_embedding_hnsw"
  ON "posts" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX "comments_embedding_hnsw"
  ON "comments" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX "topics_embedding_hnsw"
  ON "topics" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Interests are few (tens per user), so an index would never be used; the
-- planner will always prefer a sequential scan. Deliberately not indexed.

RESET maintenance_work_mem;

-- ===========================================================================
-- 4. Composite indexes for the filtered search paths
-- ===========================================================================
-- HNSW applies filters after the index scan, so a selective WHERE can return
-- fewer than LIMIT rows. B-tree indexes on the filter columns let the planner
-- choose a filtered scan when the predicate is selective enough.

CREATE INDEX "posts_language_published_at_idx"
  ON "posts" ("language", "published_at" DESC);
CREATE INDEX "posts_source_language_idx"
  ON "posts" ("source", "language");
CREATE INDEX "topics_classification_arabic_opportunity_idx"
  ON "topics" ("classification", "arabic_opportunity_score" DESC);
