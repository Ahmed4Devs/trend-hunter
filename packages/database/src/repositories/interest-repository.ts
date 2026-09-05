import type { Interest } from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { withDatabaseErrors } from '../errors';
import { INTEREST_SELECT, toInterest } from '../mappers';

/**
 * The user's interest profile.
 *
 * Interests are strictly per user and every method takes a `userId`: there is
 * no "find by id" that does not also scope to the owner, so an ownership check
 * cannot be forgotten at a call site. A request for someone else's interest
 * returns `null` rather than a 403, which also avoids confirming that the id
 * exists.
 */

export interface InterestInput {
  readonly name: string;
  readonly description?: string | null;
  readonly weight: number;
  readonly enabled: boolean;
  readonly keywords: readonly { keyword: string; weight: number }[];
}

export function createInterestRepository(client: PrismaClient) {
  return {
    async listForUser(userId: string): Promise<Interest[]> {
      return withDatabaseErrors('Interest', async () => {
        const rows = await client.interest.findMany({
          where: { userId },
          select: INTEREST_SELECT,
          orderBy: [{ weight: 'desc' }, { name: 'asc' }],
        });
        return rows.map(toInterest);
      });
    },

    async findForUser(userId: string, id: string): Promise<Interest | null> {
      return withDatabaseErrors('Interest', async () => {
        const row = await client.interest.findFirst({
          where: { id, userId },
          select: INTEREST_SELECT,
        });
        return row === null ? null : toInterest(row);
      });
    },

    async create(userId: string, input: InterestInput): Promise<Interest> {
      return withDatabaseErrors('Interest', async () => {
        const row = await client.interest.create({
          data: {
            userId,
            name: input.name,
            description: input.description ?? null,
            weight: input.weight,
            enabled: input.enabled,
            keywords: {
              create: input.keywords.map((keyword) => ({
                keyword: keyword.keyword,
                weight: keyword.weight,
              })),
            },
          },
          select: INTEREST_SELECT,
        });
        return toInterest(row);
      });
    },

    /**
     * Updates an interest and, when keywords are supplied, replaces them
     * wholesale in the same transaction.
     *
     * Replacing rather than diffing is deliberate: the UI edits the keyword list
     * as one field, and a partial update would leave orphaned keywords that
     * silently keep contributing to relevance scores.
     */
    async update(
      userId: string,
      id: string,
      input: Partial<InterestInput>,
    ): Promise<Interest | null> {
      return withDatabaseErrors('Interest', async () => {
        const owned = await client.interest.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (owned === null) return null;

        const row = await client.$transaction(async (tx) => {
          if (input.keywords !== undefined) {
            await tx.interestKeyword.deleteMany({ where: { interestId: id } });
            if (input.keywords.length > 0) {
              await tx.interestKeyword.createMany({
                data: input.keywords.map((keyword) => ({
                  interestId: id,
                  keyword: keyword.keyword,
                  weight: keyword.weight,
                })),
                skipDuplicates: true,
              });
            }
          }
          return tx.interest.update({
            where: { id },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(input.weight !== undefined ? { weight: input.weight } : {}),
              ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
              // The interest text changed, so its centroid is stale. The
              // embeddings worker rebuilds it on its next pass.
              ...(input.name !== undefined ||
              input.description !== undefined ||
              input.keywords !== undefined
                ? { updatedAt: new Date() }
                : {}),
            },
            select: INTEREST_SELECT,
          });
        });

        return toInterest(row);
      });
    },

    async delete(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('Interest', async () => {
        const result = await client.interest.deleteMany({ where: { id, userId } });
        return result.count > 0;
      });
    },

    /**
     * Loads enabled interests with their centroid embeddings, for scoring.
     *
     * The embedding is read through raw SQL because pgvector columns are
     * invisible to the Prisma query API.
     */
    async loadScoringProfile(userId: string): Promise<
      {
        id: string;
        name: string;
        weight: number;
        enabled: boolean;
        keywords: { keyword: string; weight: number }[];
        embedding: number[] | undefined;
      }[]
    > {
      return withDatabaseErrors('Interest', async () => {
        const [interests, embeddings] = await Promise.all([
          client.interest.findMany({
            where: { userId, enabled: true },
            select: INTEREST_SELECT,
          }),
          client.$queryRaw<{ id: string; embedding: string | null }[]>`
            SELECT "id", "embedding"::text AS "embedding"
            FROM "interests"
            WHERE "user_id" = ${userId} AND "enabled" = true
          `,
        ]);

        const embeddingById = new Map<string, number[]>();
        for (const row of embeddings) {
          if (row.embedding === null) continue;
          embeddingById.set(row.id, JSON.parse(row.embedding) as number[]);
        }

        return interests.map((interest) => ({
          id: interest.id,
          name: interest.name,
          weight: interest.weight,
          enabled: interest.enabled,
          keywords: interest.keywords.map((keyword) => ({
            keyword: keyword.keyword,
            weight: keyword.weight,
          })),
          embedding: embeddingById.get(interest.id),
        }));
      });
    },

    /** Text used to build an interest's centroid embedding. */
    async loadEmbeddingSources(userId: string): Promise<{ id: string; text: string }[]> {
      return withDatabaseErrors('Interest', async () => {
        const rows = await client.interest.findMany({
          where: { userId, enabled: true },
          select: INTEREST_SELECT,
        });
        return rows.map((row) => ({
          id: row.id,
          text: [row.name, row.description ?? '', ...row.keywords.map((k) => k.keyword)]
            .filter((part) => part.length > 0)
            .join('. '),
        }));
      });
    },
  };
}

export type InterestRepository = ReturnType<typeof createInterestRepository>;
