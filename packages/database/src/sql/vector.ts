import { EMBEDDING_DIMENSIONS } from '@trendhunter/shared';
import { AppError } from '@trendhunter/shared';

import type { PrismaClient } from '../client';
import { Prisma } from '../client';

/**
 * pgvector access.
 *
 * `Unsupported("vector(768)")` columns are invisible to the Prisma query API —
 * they cannot be selected, created or filtered — so every read and write of an
 * embedding goes through parameterised raw SQL here. Nothing outside this file
 * builds vector SQL, which keeps the injection surface to one reviewable module.
 *
 * Two rules are absolute:
 *
 *  1. A vector is always bound as a parameter and then cast (`$1::vector`).
 *     It is never interpolated, however "safe" the source looks.
 *  2. The `ORDER BY` repeats the full distance expression rather than
 *     referencing the alias. Ordering by the alias, or by ordinal, means
 *     PostgreSQL computes distances for every row and sorts afterwards — the
 *     HNSW index is silently skipped and the query degrades to a sequential
 *     scan without any error to notice.
 */

/** Tables that carry an embedding column. Used to whitelist raw identifiers. */
const VECTOR_TABLES = {
  posts: { table: 'posts', idColumn: 'id' },
  comments: { table: 'comments', idColumn: 'id' },
  topics: { table: 'topics', idColumn: 'id' },
  interests: { table: 'interests', idColumn: 'id' },
} as const;

export type VectorTable = keyof typeof VECTOR_TABLES;

/**
 * Serialises a vector to pgvector's text form.
 *
 * Validates dimension and finiteness first: a NaN reaching the column would be
 * accepted by PostgreSQL and then quietly corrupt every HNSW comparison
 * involving that row.
 */
export function toVectorLiteral(
  vector: readonly number[],
  dimensions: number = EMBEDDING_DIMENSIONS,
): string {
  if (vector.length !== dimensions) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Embedding has ${vector.length} dimensions, expected ${dimensions}.`,
      { expose: false },
    );
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new AppError('INTERNAL_ERROR', 'Embedding contains a non-finite value.', {
        expose: false,
      });
    }
  }
  return JSON.stringify(vector);
}

/** Parses pgvector's text form back into numbers. */
export function fromVectorLiteral(literal: string): number[] {
  const parsed: unknown = JSON.parse(literal);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'number')) {
    throw new AppError('INTERNAL_ERROR', 'Malformed vector literal.', { expose: false });
  }
  return parsed as number[];
}

/**
 * Converts cosine *distance* (0..2, as returned by `<=>`) to a similarity in
 * 0..1. Used consistently across the codebase; mixing this with the
 * `1 - distance` form would make thresholds meaningless.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.min(1, Math.max(0, (2 - distance) / 2));
}

export interface VectorNeighbour {
  readonly id: string;
  readonly distance: number;
  readonly similarity: number;
}

export interface VectorSearchOptions {
  readonly table: VectorTable;
  readonly embedding: readonly number[];
  readonly limit: number;
  /** Ids to exclude, typically the query row itself. */
  readonly excludeIds?: readonly string[];
  /**
   * Raises `hnsw.ef_search` for this query. Must be at least `limit`; a value
   * of roughly 4-8x the limit trades latency for recall.
   */
  readonly efSearch?: number;
}

/**
 * K-nearest neighbours by cosine distance.
 *
 * Runs inside an interactive transaction because `SET LOCAL hnsw.ef_search` is
 * connection-scoped: issued outside a transaction it might land on a different
 * pooled connection than the query it was meant to tune.
 */
export async function findNearestNeighbours(
  client: PrismaClient,
  options: VectorSearchOptions,
): Promise<VectorNeighbour[]> {
  const target = VECTOR_TABLES[options.table];
  const literal = toVectorLiteral(options.embedding);
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit)));
  const efSearch = Math.max(limit, Math.min(1000, options.efSearch ?? limit * 4));
  const excluded = options.excludeIds ?? [];

  // `Prisma.raw` is used only for the table and column names, and only for
  // values read out of the VECTOR_TABLES literal above. No request data ever
  // reaches it.
  const table = Prisma.raw(`"${target.table}"`);
  const idColumn = Prisma.raw(`"${target.idColumn}"`);

  const exclusion =
    excluded.length > 0
      ? Prisma.sql`AND ${idColumn} NOT IN (${Prisma.join([...excluded])})`
      : Prisma.empty;

  const rows = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(efSearch)}, true)`;
    return tx.$queryRaw<{ id: string; distance: number }[]>`
      SELECT ${idColumn} AS "id",
             ("embedding" <=> ${literal}::vector) AS "distance"
      FROM ${table}
      WHERE "embedding" IS NOT NULL
        ${exclusion}
      ORDER BY "embedding" <=> ${literal}::vector
      LIMIT ${limit}
    `;
  });

  return rows.map((row) => ({
    id: row.id,
    distance: row.distance,
    similarity: cosineDistanceToSimilarity(row.distance),
  }));
}

/** Writes one embedding. Returns the number of rows updated (0 or 1). */
export async function setEmbedding(
  client: PrismaClient,
  table: VectorTable,
  id: string,
  embedding: readonly number[],
): Promise<number> {
  const target = VECTOR_TABLES[table];
  const literal = toVectorLiteral(embedding);
  const tableRef = Prisma.raw(`"${target.table}"`);
  const idColumn = Prisma.raw(`"${target.idColumn}"`);

  return client.$executeRaw`
    UPDATE ${tableRef}
    SET "embedding" = ${literal}::vector
    WHERE ${idColumn} = ${id}
  `;
}

/**
 * Writes many embeddings in one statement.
 *
 * A row-at-a-time loop would issue one round trip per post; an ingestion run
 * embeds hundreds at a time, so this uses a single `UPDATE ... FROM (VALUES ...)`
 * with every value bound.
 */
export async function setEmbeddings(
  client: PrismaClient,
  table: VectorTable,
  entries: readonly { id: string; embedding: readonly number[] }[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const target = VECTOR_TABLES[table];
  const tableRef = Prisma.raw(`"${target.table}"`);
  const idColumn = Prisma.raw(`"${target.idColumn}"`);

  const values = entries.map(
    (entry) => Prisma.sql`(${entry.id}, ${toVectorLiteral(entry.embedding)}::vector)`,
  );

  return client.$executeRaw`
    UPDATE ${tableRef} AS target
    SET "embedding" = source.embedding
    FROM (VALUES ${Prisma.join(values)}) AS source(id, embedding)
    WHERE target.${idColumn} = source.id
  `;
}

/** Reads one embedding back, for diagnostics and tests. */
export async function getEmbedding(
  client: PrismaClient,
  table: VectorTable,
  id: string,
): Promise<number[] | null> {
  const target = VECTOR_TABLES[table];
  const tableRef = Prisma.raw(`"${target.table}"`);
  const idColumn = Prisma.raw(`"${target.idColumn}"`);

  const rows = await client.$queryRaw<{ embedding: string | null }[]>`
    SELECT "embedding"::text AS "embedding"
    FROM ${tableRef}
    WHERE ${idColumn} = ${id}
    LIMIT 1
  `;
  const literal = rows[0]?.embedding;
  return literal === null || literal === undefined ? null : fromVectorLiteral(literal);
}

/** Ids of rows that still need an embedding, oldest first. */
export async function findRowsMissingEmbedding(
  client: PrismaClient,
  table: VectorTable,
  limit: number,
): Promise<string[]> {
  const target = VECTOR_TABLES[table];
  const tableRef = Prisma.raw(`"${target.table}"`);
  const idColumn = Prisma.raw(`"${target.idColumn}"`);
  const bounded = Math.max(1, Math.min(1000, Math.trunc(limit)));

  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT ${idColumn} AS "id"
    FROM ${tableRef}
    WHERE "embedding" IS NULL
    ORDER BY "created_at" ASC
    LIMIT ${bounded}
  `;
  return rows.map((row) => row.id);
}
