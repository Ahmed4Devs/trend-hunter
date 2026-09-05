import { NotFoundError } from '@trendhunter/shared';
import {
  idParamSchema,
  listCommentsQuerySchema,
  listPostsQuerySchema,
  updatePostBodySchema,
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
import { commentSchema, postDetailSchema, postSchema } from '../http/schemas';

/**
 * Posts.
 *
 * Reads are shared: collected content belongs to the deployment, not to a user,
 * so any signed-in caller may list it. The per-user state that hangs off a post
 * — read, saved, hidden — is scoped in the query, and translations are only
 * ever loaded for the caller.
 */
export const postRoutes: RouteModule = (app) => {
  const { repositories } = app.container;

  app.route({
    method: 'GET',
    url: '/posts',
    schema: {
      operationId: 'listPosts',
      tags: ['posts'],
      summary: 'List collected posts',
      description:
        'Server-side pagination, filtering and sorting. Hidden posts are excluded unless `includeHidden` is set.',
      querystring: listPostsQuerySchema,
      response: { 200: paginatedEnvelope(postSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      currentUser(request);
      const query = request.query;

      const result = await repositories.posts.list({
        pagination: { page: query.page, pageSize: query.pageSize },
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        filters: {
          ...(query.sources === undefined ? {} : { sources: query.sources }),
          ...(query.languages === undefined ? {} : { languages: query.languages }),
          ...(query.topicId === undefined ? {} : { topicId: query.topicId }),
          ...(query.publishedFrom === undefined
            ? {}
            : { publishedFrom: new Date(query.publishedFrom) }),
          ...(query.publishedTo === undefined ? {} : { publishedTo: new Date(query.publishedTo) }),
          ...(query.minRelevance === undefined ? {} : { minRelevance: query.minRelevance }),
          ...(query.minTrend === undefined ? {} : { minTrend: query.minTrend }),
          ...(query.minOpportunity === undefined ? {} : { minOpportunity: query.minOpportunity }),
          ...(query.isSaved === undefined ? {} : { isSaved: query.isSaved }),
          ...(query.isRead === undefined ? {} : { isRead: query.isRead }),
          includeHidden: query.includeHidden,
        },
      });

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/posts/:id',
    schema: {
      operationId: 'getPost',
      tags: ['posts'],
      summary: 'Get one post with its comments, translations and related posts',
      params: idParamSchema,
      response: {
        200: successEnvelope(postDetailSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const post = await repositories.posts.findDetailById(request.params.id, session.user.id);
      if (post === null) throw new NotFoundError('Post');
      return ok(post);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/posts/:id',
    schema: {
      operationId: 'updatePost',
      tags: ['posts'],
      summary: 'Mark a post as read or hidden',
      params: idParamSchema,
      body: updatePostBodySchema,
      response: {
        200: successEnvelope(postSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const { id } = request.params;
      const body = request.body;

      let post = await repositories.posts.findById(id);
      if (post === null) throw new NotFoundError('Post');

      if (body.isRead !== undefined) post = await repositories.posts.markRead(id, body.isRead);
      if (body.isHidden !== undefined) post = await repositories.posts.setHidden(id, body.isHidden);

      return ok(post);
    },
  });

  app.route({
    method: 'GET',
    url: '/posts/:id/related',
    schema: {
      operationId: 'listRelatedPosts',
      tags: ['posts'],
      summary: 'Posts semantically closest to this one',
      description:
        'Ranked by embedding proximity rather than by topic, so the panel is still useful for a post that has not been clustered yet.',
      params: idParamSchema,
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(20).default(6) }),
      response: {
        200: successEnvelope(readonlyArray(postSchema)),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const post = await repositories.posts.findById(request.params.id);
      if (post === null) throw new NotFoundError('Post');
      return ok(await repositories.posts.findRelated(request.params.id, request.query.limit));
    },
  });

  app.route({
    method: 'GET',
    url: '/comments',
    schema: {
      operationId: 'listComments',
      tags: ['posts'],
      summary: 'List comments',
      description:
        'Comments are stored separately from posts because they are where problems and questions surface, which is what the opportunity detection reads.',
      querystring: listCommentsQuerySchema,
      response: { 200: paginatedEnvelope(commentSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      currentUser(request);
      const query = request.query;
      const result = await repositories.posts.listComments({
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.postId === undefined ? {} : { postId: query.postId }),
        ...(query.languages === undefined ? {} : { languages: query.languages }),
      });
      return paginated(result.items, result.pagination);
    },
  });

  return Promise.resolve();
};
