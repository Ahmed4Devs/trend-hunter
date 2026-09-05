import {
  MAX_THREAD_LENGTH,
  NotFoundError,
  ValidationError,
  X_LONG_POST_CHARACTER_LIMIT,
} from '@trendhunter/shared';
import { MAX_PAGE_SIZE, type ManualPublication } from '@trendhunter/types';
import {
  boundedTextSchema,
  createManualPublicationBodySchema,
  createSavedItemBodySchema,
  idParamSchema,
  listManualPublicationsQuerySchema,
  listSavedItemsQuerySchema,
  publicHttpsUrlSchema,
} from '@trendhunter/validation';
import { z } from 'zod';

import {
  commonErrorResponses,
  notFoundResponse,
  ok,
  paginated,
  paginatedEnvelope,
  readonlyArray,
  successEnvelope,
} from '../http/envelope';
import { currentUser, type RouteModule } from '../http/route';
import { manualPublicationSchema, savedItemSchema } from '../http/schemas';

/**
 * Saved items and manual publications.
 *
 * Both are private to the caller, so every query is scoped by user id inside
 * the repository rather than filtered after loading: an endpoint that fetches
 * by id and then compares owners has already told the caller that the id
 * exists.
 *
 * V1 never publishes anything. The `/manual-publications` endpoints are pure
 * bookkeeping — the user posts to X by hand and then records what they posted,
 * which is what makes "what was generated versus what was actually shipped"
 * answerable later.
 */

/**
 * A 204 carries no body. Fastify short-circuits a null payload before the
 * serializer runs, so this schema only documents the status in OpenAPI.
 */
const noContentResponse = {
  204: z.null().describe('The resource was deleted.'),
} as const;

/**
 * `@trendhunter/validation` has no update schema for a publication, because the
 * only two fields worth changing are the ones a user gets wrong at record time:
 * the permalink they pasted and the text they tweaked in X's composer. Bounded
 * exactly as the create schema bounds them.
 */
const updateManualPublicationBodySchema = z
  .object({
    publishedUrl: publicHttpsUrlSchema.nullable().optional(),
    publishedContent: boundedTextSchema(X_LONG_POST_CHARACTER_LIMIT * MAX_THREAD_LENGTH).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

export const savedRoutes: RouteModule = (app) => {
  const { repositories } = app.container;

  app.route({
    method: 'GET',
    url: '/saved',
    schema: {
      operationId: 'listSavedItems',
      tags: ['saved'],
      summary: 'List the saved items of the caller',
      querystring: listSavedItemsQuerySchema,
      response: { 200: paginatedEnvelope(savedItemSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;

      const result = await repositories.saved.list(session.user.id, {
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.collection === undefined ? {} : { collection: query.collection }),
      });

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'POST',
    url: '/saved',
    schema: {
      operationId: 'createSavedItem',
      tags: ['saved'],
      summary: 'Save a post, topic, thread or draft',
      description:
        'Idempotent: saving something already saved updates its note and collection rather than failing.',
      body: createSavedItemBodySchema,
      response: {
        200: successEnvelope(savedItemSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const userId = session.user.id;
      const body = request.body;

      // The body schema guarantees exactly one identifier, but not that it is
      // the one `kind` names. A mismatched pair would be written against the
      // wrong unique index and read back as a save of a different thing.
      const targetId = {
        POST: body.postId,
        TOPIC: body.topicId,
        THREAD: body.threadId,
        CONTENT_DRAFT: body.contentDraftId,
      }[body.kind];
      if (targetId === undefined) {
        throw new ValidationError('The target identifier does not match the saved item kind.');
      }

      // A save of something that does not exist leaves a dangling row every
      // list query then has to render. Posts and topics belong to the
      // deployment; threads and drafts belong to a user, so they are loaded
      // through the scoped methods — answering 404 rather than saving is what
      // stops the endpoint confirming that another user's draft exists.
      switch (body.kind) {
        case 'POST': {
          if ((await repositories.posts.findById(targetId)) === null) {
            throw new NotFoundError('Post');
          }
          break;
        }
        case 'TOPIC': {
          if ((await repositories.topics.findById(targetId)) === null) {
            throw new NotFoundError('Topic');
          }
          break;
        }
        case 'THREAD': {
          if ((await repositories.content.findThread(userId, targetId)) === null) {
            throw new NotFoundError('Thread');
          }
          break;
        }
        case 'CONTENT_DRAFT': {
          if ((await repositories.content.findDraft(userId, targetId)) === null) {
            throw new NotFoundError('Content draft');
          }
          break;
        }
      }

      const saved = await repositories.saved.save({
        userId,
        kind: body.kind,
        ...(body.postId === undefined ? {} : { postId: body.postId }),
        ...(body.topicId === undefined ? {} : { topicId: body.topicId }),
        ...(body.threadId === undefined ? {} : { threadId: body.threadId }),
        ...(body.contentDraftId === undefined ? {} : { contentDraftId: body.contentDraftId }),
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.collection === undefined ? {} : { collection: body.collection }),
      });

      return ok(saved);
    },
  });

  app.route({
    method: 'GET',
    url: '/saved/collections',
    schema: {
      operationId: 'listSavedCollections',
      tags: ['saved'],
      summary: 'The collection names the caller has used',
      description:
        'Collections are a free-text field rather than a table, so the set of names is derived from the saved items themselves.',
      response: {
        200: successEnvelope(readonlyArray(z.string())),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      return ok(await repositories.saved.listCollections(session.user.id));
    },
  });

  app.route({
    method: 'DELETE',
    url: '/saved/:id',
    schema: {
      operationId: 'deleteSavedItem',
      tags: ['saved'],
      summary: 'Remove a saved item',
      params: idParamSchema,
      response: { ...noContentResponse, ...commonErrorResponses, ...notFoundResponse },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const removed = await repositories.saved.unsave(session.user.id, request.params.id);
      if (!removed) throw new NotFoundError('Saved item');
      return reply.code(204).send(null);
    },
  });

  app.route({
    method: 'GET',
    url: '/manual-publications',
    schema: {
      operationId: 'listManualPublications',
      tags: ['publications'],
      summary: 'List what the caller has published by hand',
      querystring: listManualPublicationsQuerySchema,
      response: { 200: paginatedEnvelope(manualPublicationSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;

      const result = await repositories.content.listPublications(session.user.id, {
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.topicId === undefined ? {} : { topicId: query.topicId }),
        ...(query.contentKind === undefined ? {} : { contentKind: query.contentKind }),
      });

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'POST',
    url: '/manual-publications',
    schema: {
      operationId: 'createManualPublication',
      tags: ['publications'],
      summary: 'Record something published on X by hand',
      description:
        'Records only. The API never posts to X. Marks the source draft or thread as published and stores what was generated next to what was actually posted.',
      body: createManualPublicationBodySchema,
      response: {
        201: successEnvelope(manualPublicationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const userId = session.user.id;
      const body = request.body;

      // The generated text is read back from the source rather than accepted
      // from the client, so a record cannot claim the model produced something
      // it did not. Both lookups are scoped to the caller: publishing against
      // another user's draft must be indistinguishable from publishing against
      // one that does not exist.
      let originalContent: string | null = null;
      let sourceTopicId: string | null = null;

      if (body.contentDraftId !== undefined) {
        const draft = await repositories.content.findDraft(userId, body.contentDraftId);
        if (draft === null) throw new NotFoundError('Content draft');
        originalContent = draft.content;
        sourceTopicId = draft.topicId;
      }

      if (body.threadId !== undefined) {
        const thread = await repositories.content.findThread(userId, body.threadId);
        if (thread === null) throw new NotFoundError('Thread');
        // A thread is stored as a chain of posts but published as one body of
        // text, so it is joined here to stay comparable with
        // `publishedContent`. When a draft is given as well it is the more
        // specific source and wins.
        originalContent ??= thread.posts.map((post) => post.content).join('\n\n');
        sourceTopicId ??= thread.topicId;
      }

      // Unreachable: the body schema requires a draft or a thread. Written as a
      // check rather than an assertion so the type stays honest.
      if (originalContent === null) {
        throw new ValidationError('Either contentDraftId or threadId is required.');
      }

      const publication = await repositories.content.createPublication({
        userId,
        contentKind: body.contentKind,
        language: body.language,
        originalContent,
        publishedContent: body.publishedContent,
        publishedUrl: body.publishedUrl ?? null,
        // Recording after the fact is the normal case, so a stated time is
        // honoured and "now" is only the fallback.
        publishedAt: body.publishedAt === undefined ? new Date() : new Date(body.publishedAt),
        ...(body.contentDraftId === undefined ? {} : { contentDraftId: body.contentDraftId }),
        ...(body.threadId === undefined ? {} : { threadId: body.threadId }),
        // Inheriting the source's topic keeps the record filterable by topic
        // without the client repeating what the draft already knows.
        topicId: body.topicId ?? sourceTopicId,
      });

      return reply.code(201).send(ok(publication));
    },
  });

  app.route({
    method: 'GET',
    url: '/manual-publications/:id',
    schema: {
      operationId: 'getManualPublication',
      tags: ['publications'],
      summary: 'Get one manual publication',
      params: idParamSchema,
      response: {
        200: successEnvelope(manualPublicationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const publication = await findPublication(session.user.id, request.params.id);
      if (publication === null) throw new NotFoundError('Manual publication');
      return ok(publication);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/manual-publications/:id',
    schema: {
      operationId: 'updateManualPublication',
      tags: ['publications'],
      summary: 'Correct the permalink or the published text of a record',
      params: idParamSchema,
      body: updateManualPublicationBodySchema,
      response: {
        200: successEnvelope(manualPublicationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const body = request.body;

      const updated = await repositories.content.updatePublication(
        session.user.id,
        request.params.id,
        {
          ...(body.publishedUrl === undefined ? {} : { publishedUrl: body.publishedUrl }),
          ...(body.publishedContent === undefined
            ? {}
            : { publishedContent: body.publishedContent }),
        },
      );
      if (updated === null) throw new NotFoundError('Manual publication');
      return ok(updated);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/manual-publications/:id',
    schema: {
      operationId: 'deleteManualPublication',
      tags: ['publications'],
      summary: 'Delete a manual publication record',
      description:
        'Removes the bookkeeping record only. Nothing is deleted from X, and the source draft keeps its published status.',
      params: idParamSchema,
      response: { ...noContentResponse, ...commonErrorResponses, ...notFoundResponse },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const removed = await repositories.content.deletePublication(
        session.user.id,
        request.params.id,
      );
      if (!removed) throw new NotFoundError('Manual publication');
      return reply.code(204).send(null);
    },
  });

  /**
   * Fetches one publication belonging to the caller.
   *
   * The content repository exposes no scoped single-fetch for publications, and
   * a lookup by id alone would answer "this exists" for another user's record,
   * so the caller's own list is walked instead. A publication history is a
   * hand-written log of things the user posted personally, so the walk almost
   * always ends on the first page.
   */
  async function findPublication(userId: string, id: string): Promise<ManualPublication | null> {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const result = await repositories.content.listPublications(userId, {
        pagination: { page, pageSize: MAX_PAGE_SIZE },
      });
      const match = result.items.find((item) => item.id === id);
      if (match !== undefined) return match;
      totalPages = result.pagination.totalPages;
      page += 1;
    }
    return null;
  }

  return Promise.resolve();
};
