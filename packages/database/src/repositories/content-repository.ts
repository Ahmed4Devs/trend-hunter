import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '@trendhunter/shared';
import type {
  ContentDraft,
  ContentDraftKind,
  ContentDraftStatus,
  ContentLanguage,
  ManualPublication,
  Paginated,
  PaginationParams,
  Thread,
  Translation,
  TranslationMode,
  TranslationTargetKind,
  TerminologyPreference,
} from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { withDatabaseErrors } from '../errors';
import {
  CONTENT_DRAFT_SELECT,
  MANUAL_PUBLICATION_SELECT,
  THREAD_SELECT,
  TRANSLATION_SELECT,
  toContentDraft,
  toManualPublication,
  toThread,
  toTranslation,
} from '../mappers';

/**
 * Content Studio persistence: drafts, threads, translations and the record of
 * what the user published by hand.
 *
 * Everything here is user-owned, so every method scopes by `userId` in the
 * query itself. There is no method that loads a draft without an owner.
 */

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface CreateDraftInput {
  readonly userId: string;
  readonly kind: ContentDraftKind;
  readonly language: ContentLanguage;
  readonly title: string | null;
  readonly content: string;
  readonly characterCount: number;
  readonly tone: string | null;
  readonly providerName: string;
  readonly topicId?: string | null;
  readonly postId?: string | null;
  readonly threadId?: string | null;
}

export function createContentRepository(client: PrismaClient) {
  return {
    async listDrafts(
      userId: string,
      options: {
        kind?: ContentDraftKind;
        status?: ContentDraftStatus;
        topicId?: string;
        savedOnly?: boolean;
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<ContentDraft>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        userId,
        ...(options.kind === undefined ? {} : { kind: options.kind }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.topicId === undefined ? {} : { topicId: options.topicId }),
        ...(options.savedOnly === true ? { isSaved: true } : {}),
      };

      return withDatabaseErrors('ContentDraft', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.contentDraft.findMany({
            where,
            select: CONTENT_DRAFT_SELECT,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.contentDraft.count({ where }),
        ]);
        return {
          items: rows.map(toContentDraft),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async findDraft(userId: string, id: string): Promise<ContentDraft | null> {
      return withDatabaseErrors('ContentDraft', async () => {
        const row = await client.contentDraft.findFirst({
          where: { id, userId },
          select: CONTENT_DRAFT_SELECT,
        });
        return row === null ? null : toContentDraft(row);
      });
    },

    async createDraft(input: CreateDraftInput): Promise<ContentDraft> {
      return withDatabaseErrors('ContentDraft', async () => {
        const row = await client.contentDraft.create({
          data: {
            userId: input.userId,
            kind: input.kind,
            language: input.language,
            title: input.title,
            content: input.content,
            characterCount: input.characterCount,
            tone: input.tone,
            providerName: input.providerName,
            topicId: input.topicId ?? null,
            postId: input.postId ?? null,
            threadId: input.threadId ?? null,
          },
          select: CONTENT_DRAFT_SELECT,
        });
        return toContentDraft(row);
      });
    },

    async updateDraft(
      userId: string,
      id: string,
      data: {
        title?: string | null;
        content?: string;
        characterCount?: number;
        status?: ContentDraftStatus;
        isSaved?: boolean;
      },
    ): Promise<ContentDraft | null> {
      return withDatabaseErrors('ContentDraft', async () => {
        // updateMany scopes the write to the owner in one statement, so there is
        // no window between an ownership check and the update.
        const result = await client.contentDraft.updateMany({ where: { id, userId }, data });
        if (result.count === 0) return null;
        const row = await client.contentDraft.findUniqueOrThrow({
          where: { id },
          select: CONTENT_DRAFT_SELECT,
        });
        return toContentDraft(row);
      });
    },

    async deleteDraft(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('ContentDraft', async () => {
        const result = await client.contentDraft.deleteMany({ where: { id, userId } });
        return result.count > 0;
      });
    },

    async countDraftsInWindow(userId: string, from: Date, to: Date): Promise<number> {
      return withDatabaseErrors('ContentDraft', () =>
        client.contentDraft.count({ where: { userId, createdAt: { gte: from, lt: to } } }),
      );
    },

    // -----------------------------------------------------------------------
    // Threads
    // -----------------------------------------------------------------------

    async listThreads(
      userId: string,
      options: {
        status?: ContentDraftStatus;
        topicId?: string;
        savedOnly?: boolean;
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<Thread>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        userId,
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.topicId === undefined ? {} : { topicId: options.topicId }),
        ...(options.savedOnly === true ? { isSaved: true } : {}),
      };

      return withDatabaseErrors('Thread', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.thread.findMany({
            where,
            select: THREAD_SELECT,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.thread.count({ where }),
        ]);
        return {
          items: rows.map(toThread),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async findThread(userId: string, id: string): Promise<Thread | null> {
      return withDatabaseErrors('Thread', async () => {
        const row = await client.thread.findFirst({
          where: { id, userId },
          select: THREAD_SELECT,
        });
        return row === null ? null : toThread(row);
      });
    },

    async createThread(input: {
      userId: string;
      topicId?: string | null;
      title: string;
      language: ContentLanguage;
      posts: readonly { position: number; content: string; characterCount: number }[];
    }): Promise<Thread> {
      return withDatabaseErrors('Thread', async () => {
        const row = await client.thread.create({
          data: {
            userId: input.userId,
            topicId: input.topicId ?? null,
            title: input.title,
            language: input.language,
            posts: {
              create: input.posts.map((post) => ({
                position: post.position,
                content: post.content,
                characterCount: post.characterCount,
              })),
            },
          },
          select: THREAD_SELECT,
        });
        return toThread(row);
      });
    },

    /**
     * Updates a thread, replacing its posts when new ones are supplied.
     *
     * The posts are deleted and recreated inside one transaction rather than
     * diffed by position: positions shift when the user reorders or removes a
     * post, and an update-by-position would silently corrupt the sequence.
     */
    async updateThread(
      userId: string,
      id: string,
      data: {
        title?: string;
        status?: ContentDraftStatus;
        isSaved?: boolean;
        language?: ContentLanguage;
        posts?: readonly { position: number; content: string; characterCount: number }[];
      },
    ): Promise<Thread | null> {
      return withDatabaseErrors('Thread', async () => {
        const owned = await client.thread.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (owned === null) return null;

        const row = await client.$transaction(async (tx) => {
          if (data.posts !== undefined) {
            await tx.threadPost.deleteMany({ where: { threadId: id } });
            await tx.threadPost.createMany({
              data: data.posts.map((post) => ({
                threadId: id,
                position: post.position,
                content: post.content,
                characterCount: post.characterCount,
              })),
            });
          }
          return tx.thread.update({
            where: { id },
            data: {
              ...(data.title === undefined ? {} : { title: data.title }),
              ...(data.status === undefined ? {} : { status: data.status }),
              ...(data.isSaved === undefined ? {} : { isSaved: data.isSaved }),
              ...(data.language === undefined ? {} : { language: data.language }),
            },
            select: THREAD_SELECT,
          });
        });
        return toThread(row);
      });
    },

    async deleteThread(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('Thread', async () => {
        const result = await client.thread.deleteMany({ where: { id, userId } });
        return result.count > 0;
      });
    },

    // -----------------------------------------------------------------------
    // Translations
    // -----------------------------------------------------------------------

    async listTranslations(
      userId: string,
      options: {
        targetKind?: TranslationTargetKind;
        mode?: TranslationMode;
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<Translation>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        userId,
        ...(options.targetKind === undefined ? {} : { targetKind: options.targetKind }),
        ...(options.mode === undefined ? {} : { mode: options.mode }),
      };

      return withDatabaseErrors('Translation', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.translation.findMany({
            where,
            select: TRANSLATION_SELECT,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.translation.count({ where }),
        ]);
        return {
          items: rows.map(toTranslation),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async findTranslation(userId: string, id: string): Promise<Translation | null> {
      return withDatabaseErrors('Translation', async () => {
        const row = await client.translation.findFirst({
          where: { id, userId },
          select: TRANSLATION_SELECT,
        });
        return row === null ? null : toTranslation(row);
      });
    },

    /**
     * Finds an existing translation of the same target in the same mode.
     *
     * Translation is the most expensive operation in the product, so the
     * service checks here before spending a provider call.
     */
    async findExistingTranslation(input: {
      userId: string;
      targetKind: TranslationTargetKind;
      postId?: string | null;
      commentId?: string | null;
      threadId?: string | null;
      mode: TranslationMode;
      targetLanguage: ContentLanguage;
    }): Promise<Translation | null> {
      return withDatabaseErrors('Translation', async () => {
        const row = await client.translation.findFirst({
          where: {
            userId: input.userId,
            targetKind: input.targetKind,
            postId: input.postId ?? null,
            commentId: input.commentId ?? null,
            threadId: input.threadId ?? null,
            mode: input.mode,
            targetLanguage: input.targetLanguage,
          },
          select: TRANSLATION_SELECT,
          orderBy: { createdAt: 'desc' },
        });
        return row === null ? null : toTranslation(row);
      });
    },

    async createTranslation(input: {
      userId: string;
      targetKind: TranslationTargetKind;
      postId?: string | null;
      commentId?: string | null;
      threadId?: string | null;
      topicId?: string | null;
      sourceLanguage: ContentLanguage;
      targetLanguage: ContentLanguage;
      mode: TranslationMode;
      terminologyPreference: TerminologyPreference;
      sourceContent: string;
      translatedContent: string;
      preservedTerms: readonly string[];
      explanation: string | null;
      providerName: string;
    }): Promise<Translation> {
      return withDatabaseErrors('Translation', async () => {
        const row = await client.translation.create({
          data: {
            userId: input.userId,
            targetKind: input.targetKind,
            postId: input.postId ?? null,
            commentId: input.commentId ?? null,
            threadId: input.threadId ?? null,
            topicId: input.topicId ?? null,
            sourceLanguage: input.sourceLanguage,
            targetLanguage: input.targetLanguage,
            mode: input.mode,
            terminologyPreference: input.terminologyPreference,
            sourceContent: input.sourceContent,
            translatedContent: input.translatedContent,
            preservedTerms: [...input.preservedTerms],
            explanation: input.explanation,
            providerName: input.providerName,
          },
          select: TRANSLATION_SELECT,
        });
        return toTranslation(row);
      });
    },

    async updateTranslation(
      userId: string,
      id: string,
      translatedContent: string,
    ): Promise<Translation | null> {
      return withDatabaseErrors('Translation', async () => {
        const result = await client.translation.updateMany({
          where: { id, userId },
          data: { translatedContent },
        });
        if (result.count === 0) return null;
        const row = await client.translation.findUniqueOrThrow({
          where: { id },
          select: TRANSLATION_SELECT,
        });
        return toTranslation(row);
      });
    },

    async deleteTranslation(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('Translation', async () => {
        const result = await client.translation.deleteMany({ where: { id, userId } });
        return result.count > 0;
      });
    },

    async countTranslationsInWindow(from: Date, to: Date): Promise<number> {
      return withDatabaseErrors('Translation', () =>
        client.translation.count({ where: { createdAt: { gte: from, lt: to } } }),
      );
    },

    // -----------------------------------------------------------------------
    // Manual publications
    // -----------------------------------------------------------------------

    async listPublications(
      userId: string,
      options: {
        topicId?: string;
        contentKind?: ContentDraftKind;
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<ManualPublication>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        userId,
        ...(options.topicId === undefined ? {} : { topicId: options.topicId }),
        ...(options.contentKind === undefined ? {} : { contentKind: options.contentKind }),
      };

      return withDatabaseErrors('ManualPublication', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.manualPublication.findMany({
            where,
            select: MANUAL_PUBLICATION_SELECT,
            orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.manualPublication.count({ where }),
        ]);
        return {
          items: rows.map(toManualPublication),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    /**
     * Records that the user published something on X by hand, and marks the
     * source draft or thread as published in the same transaction.
     *
     * V1 never publishes automatically — this is a bookkeeping record of an
     * action taken outside the system.
     */
    async createPublication(input: {
      userId: string;
      contentDraftId?: string | null;
      threadId?: string | null;
      topicId?: string | null;
      contentKind: ContentDraftKind;
      language: ContentLanguage;
      originalContent: string;
      publishedContent: string;
      publishedUrl: string | null;
      publishedAt: Date;
    }): Promise<ManualPublication> {
      return withDatabaseErrors('ManualPublication', async () => {
        const row = await client.$transaction(async (tx) => {
          const created = await tx.manualPublication.create({
            data: {
              userId: input.userId,
              contentDraftId: input.contentDraftId ?? null,
              threadId: input.threadId ?? null,
              topicId: input.topicId ?? null,
              contentKind: input.contentKind,
              language: input.language,
              originalContent: input.originalContent,
              publishedContent: input.publishedContent,
              publishedUrl: input.publishedUrl,
              publishedAt: input.publishedAt,
            },
            select: MANUAL_PUBLICATION_SELECT,
          });

          if (input.contentDraftId !== null && input.contentDraftId !== undefined) {
            await tx.contentDraft.updateMany({
              where: { id: input.contentDraftId, userId: input.userId },
              data: { status: 'PUBLISHED' },
            });
          }
          if (input.threadId !== null && input.threadId !== undefined) {
            await tx.thread.updateMany({
              where: { id: input.threadId, userId: input.userId },
              data: { status: 'PUBLISHED' },
            });
          }

          return created;
        });
        return toManualPublication(row);
      });
    },

    async updatePublication(
      userId: string,
      id: string,
      data: { publishedUrl?: string | null; publishedContent?: string },
    ): Promise<ManualPublication | null> {
      return withDatabaseErrors('ManualPublication', async () => {
        const result = await client.manualPublication.updateMany({ where: { id, userId }, data });
        if (result.count === 0) return null;
        const row = await client.manualPublication.findUniqueOrThrow({
          where: { id },
          select: MANUAL_PUBLICATION_SELECT,
        });
        return toManualPublication(row);
      });
    },

    async deletePublication(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('ManualPublication', async () => {
        const result = await client.manualPublication.deleteMany({ where: { id, userId } });
        return result.count > 0;
      });
    },
  };
}

export type ContentRepository = ReturnType<typeof createContentRepository>;
