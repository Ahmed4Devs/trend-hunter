import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '@trendhunter/shared';
import type { Paginated, PaginationParams, SavedItem, SavedItemKind } from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { withDatabaseErrors } from '../errors';
import { SAVED_ITEM_SELECT, toSavedItem } from '../mappers';

/**
 * Saved items.
 *
 * The `saved_items` table is the source of truth. `threads.is_saved` and
 * `content_drafts.is_saved` are denormalised flags that exist so a list query
 * does not need a join per row; every write here updates them inside the same
 * transaction, so the two can never disagree. Both targets belong to exactly
 * one user, which is what makes a single boolean able to describe them.
 *
 * Posts and topics carry no such flag, because they belong to the deployment
 * and are saved by each user independently: the readers join `saved_items` for
 * a whole page instead.
 */

export interface SaveItemInput {
  readonly userId: string;
  readonly kind: SavedItemKind;
  readonly postId?: string | null;
  readonly topicId?: string | null;
  readonly threadId?: string | null;
  readonly contentDraftId?: string | null;
  readonly note?: string | null;
  readonly collection?: string | null;
}

export function createSavedRepository(client: PrismaClient) {
  return {
    async list(
      userId: string,
      options: {
        kind?: SavedItemKind;
        collection?: string;
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<SavedItem>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        userId,
        ...(options.kind === undefined ? {} : { kind: options.kind }),
        ...(options.collection === undefined ? {} : { collection: options.collection }),
      };

      return withDatabaseErrors('SavedItem', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.savedItem.findMany({
            where,
            select: SAVED_ITEM_SELECT,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.savedItem.count({ where }),
        ]);
        return {
          items: rows.map(toSavedItem),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    /**
     * Saves an item, or updates the note and collection if it is already saved.
     *
     * Idempotent by design: the UI's save button is a toggle and double clicks
     * happen. The denormalised flag on the target is set in the same
     * transaction.
     */
    async save(input: SaveItemInput): Promise<SavedItem> {
      return withDatabaseErrors('SavedItem', async () => {
        const row = await client.$transaction(async (tx) => {
          const created = await tx.savedItem.upsert({
            where: uniqueWhere(input),
            update: {
              note: input.note ?? null,
              collection: input.collection ?? null,
            },
            create: {
              userId: input.userId,
              kind: input.kind,
              postId: input.postId ?? null,
              topicId: input.topicId ?? null,
              threadId: input.threadId ?? null,
              contentDraftId: input.contentDraftId ?? null,
              note: input.note ?? null,
              collection: input.collection ?? null,
            },
            select: SAVED_ITEM_SELECT,
          });

          await setSavedFlag(tx, input, true);
          return created;
        });
        return toSavedItem(row);
      });
    },

    async unsave(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('SavedItem', async () => {
        return client.$transaction(async (tx) => {
          const existing = await tx.savedItem.findFirst({
            where: { id, userId },
            select: SAVED_ITEM_SELECT,
          });
          if (existing === null) return false;

          await tx.savedItem.delete({ where: { id } });
          await setSavedFlag(
            tx,
            { threadId: existing.threadId, contentDraftId: existing.contentDraftId },
            false,
          );
          return true;
        });
      });
    },

    /** Removes a save by target rather than by saved-item id, for toggles. */
    async unsaveTarget(input: {
      userId: string;
      kind: SavedItemKind;
      postId?: string | null;
      topicId?: string | null;
      threadId?: string | null;
      contentDraftId?: string | null;
    }): Promise<boolean> {
      return withDatabaseErrors('SavedItem', async () =>
        client.$transaction(async (tx) => {
          const deleted = await tx.savedItem.deleteMany({
            where: {
              userId: input.userId,
              postId: input.postId ?? null,
              topicId: input.topicId ?? null,
              threadId: input.threadId ?? null,
              contentDraftId: input.contentDraftId ?? null,
            },
          });
          if (deleted.count === 0) return false;
          await setSavedFlag(tx, input, false);
          return true;
        }),
      );
    },

    async countForUser(userId: string, since?: Date): Promise<number> {
      return withDatabaseErrors('SavedItem', () =>
        client.savedItem.count({
          where: { userId, ...(since === undefined ? {} : { createdAt: { gte: since } }) },
        }),
      );
    },

    async countInWindow(userId: string, from: Date, to: Date): Promise<number> {
      return withDatabaseErrors('SavedItem', () =>
        client.savedItem.count({ where: { userId, createdAt: { gte: from, lt: to } } }),
      );
    },

    async listCollections(userId: string): Promise<string[]> {
      return withDatabaseErrors('SavedItem', async () => {
        const rows = await client.savedItem.findMany({
          where: { userId, collection: { not: null } },
          select: { collection: true },
          distinct: ['collection'],
          orderBy: { collection: 'asc' },
        });
        return rows
          .map((row) => row.collection)
          .filter((collection): collection is string => collection !== null);
      });
    },
  };
}

/** The compound unique that matches the target of a save. */
function uniqueWhere(input: {
  userId: string;
  postId?: string | null;
  topicId?: string | null;
  threadId?: string | null;
  contentDraftId?: string | null;
}) {
  if (input.postId !== null && input.postId !== undefined) {
    return { userId_postId: { userId: input.userId, postId: input.postId } };
  }
  if (input.topicId !== null && input.topicId !== undefined) {
    return { userId_topicId: { userId: input.userId, topicId: input.topicId } };
  }
  if (input.threadId !== null && input.threadId !== undefined) {
    return { userId_threadId: { userId: input.userId, threadId: input.threadId } };
  }
  if (input.contentDraftId !== null && input.contentDraftId !== undefined) {
    return {
      userId_contentDraftId: { userId: input.userId, contentDraftId: input.contentDraftId },
    };
  }
  // Unreachable: the request schema requires exactly one target identifier.
  throw new Error('A saved item must reference exactly one target.');
}

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Keeps the denormalised `is_saved` flag in step with the saved_items table.
 *
 * Only for the targets a single user owns outright. A post belongs to the
 * deployment and is saved by each user separately, so it carries no flag: one
 * boolean column cannot represent "saved" for one caller and "not saved" for
 * the next, and while it existed one user's save lit the button up for
 * everyone and their unsave cleared it. The post reader joins `saved_items`
 * for the whole page instead, exactly as the topic reader does.
 */
async function setSavedFlag(
  tx: TransactionClient,
  target: {
    threadId?: string | null;
    contentDraftId?: string | null;
  },
  isSaved: boolean,
): Promise<void> {
  if (target.threadId !== null && target.threadId !== undefined) {
    await tx.thread.updateMany({ where: { id: target.threadId }, data: { isSaved } });
  }
  if (target.contentDraftId !== null && target.contentDraftId !== undefined) {
    await tx.contentDraft.updateMany({ where: { id: target.contentDraftId }, data: { isSaved } });
  }
  // Topics carry no denormalised flag: the topic list already joins saved_items
  // for the whole page in one query.
}

export type SavedRepository = ReturnType<typeof createSavedRepository>;
