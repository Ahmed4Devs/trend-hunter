import { NotFoundError, windowForRange } from '@trendhunter/shared';
import {
  idParamSchema,
  listPostsQuerySchema,
  listTopicsQuerySchema,
  topicTrendQuerySchema,
  trendsQuerySchema,
  updateTopicBodySchema,
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
import {
  postSchema,
  registered,
  topicDetailSchema,
  topicSchema,
  trendSnapshotSchema,
} from '../http/schemas';

/**
 * Topics and trends.
 *
 * A topic is shared — it is derived from collected content, not owned by a
 * caller — but two of its fields are per user: `isSaved`, and whether a saved
 * filter applies at all. Both are resolved by passing the caller's id into the
 * repository rather than by post-filtering here.
 *
 * Every topic goes out with its `classificationReasons`, which is why the
 * classification is never returned on its own: an "Emerging" badge that cannot
 * say which signals fired is an assertion the user has no way to check.
 */

/**
 * The trend series on its own.
 *
 * The detail response already carries these snapshots, but the chart re-fetches
 * whenever the range control changes and has no use for the posts, breakdowns
 * and source distribution that come with a full detail payload.
 */
const topicTrendSeriesSchema = registered(
  'TopicTrendSeries',
  z.object({
    topicId: z.string(),
    topicName: z.string(),
    snapshots: readonlyArray(trendSnapshotSchema),
  }),
);

/**
 * Posts of one topic.
 *
 * The topic comes from the path, so accepting it in the query as well would let
 * a caller ask for a contradiction. Free-text search is dropped for the same
 * reason it is honest to drop it: the post repository cannot filter on it, and
 * `/search` is the endpoint that can.
 */
const topicPostsQuerySchema = listPostsQuerySchema.omit({ topicId: true, search: true });

/**
 * How many topics a free-text query may match before only the strongest matches
 * are ranked.
 *
 * The topic repository narrows by id, so the search arm has to bound itself:
 * an `IN` list that grew with the corpus would defeat the pagination it feeds.
 *
 * 100 is the ceiling the topic keyword search enforces on itself, so asking for
 * more would document a number the query would not honour.
 */
const TOPIC_SEARCH_CANDIDATE_LIMIT = 100;

export const topicRoutes: RouteModule = (app) => {
  const { repositories, services } = app.container;

  app.route({
    method: 'GET',
    url: '/topics',
    schema: {
      operationId: 'listTopics',
      tags: ['topics'],
      summary: 'List detected topics',
      description: [
        'The Topics page views are combinations of these parameters rather than',
        'separate endpoints: Trending is the default (`status=ACTIVE` ordered by',
        '`trendScore`), Emerging and Hidden Gems set `classifications`, Saved sets',
        '`savedOnly`, and Archived sets `status=ARCHIVED`.',
        '',
        'A `search` term is matched against topic names and summaries, and narrows the list',
        `to the ${String(TOPIC_SEARCH_CANDIDATE_LIMIT)} best matches before the other filters apply.`,
        'That match considers active topics only, so `search` combined with',
        '`status=ARCHIVED` returns nothing.',
      ].join(' '),
      querystring: listTopicsQuerySchema,
      response: { 200: paginatedEnvelope(topicSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;

      // Keyword-only and restricted to topics, so this resolves a name to a set
      // of ids and the repository still applies the filters and the sort. It
      // costs one text-search query and never an embedding, which is why the
      // endpoint is not rate limited as an expensive one.
      const matchedIds =
        query.search === undefined
          ? undefined
          : (
              await services.search.search({
                query: query.search,
                mode: 'keyword',
                entities: ['topic'],
                limit: TOPIC_SEARCH_CANDIDATE_LIMIT,
              })
            ).hits.map((hit) => hit.id);

      const result = await repositories.topics.list(
        {
          pagination: { page: query.page, pageSize: query.pageSize },
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
          filters: {
            status: query.status,
            ...(query.classifications === undefined
              ? {}
              : { classifications: query.classifications }),
            ...(query.sources === undefined ? {} : { sources: query.sources }),
            ...(query.minTrend === undefined ? {} : { minTrend: query.minTrend }),
            ...(query.minOpportunity === undefined ? {} : { minOpportunity: query.minOpportunity }),
            ...(matchedIds === undefined ? {} : { ids: matchedIds }),
            // Saved is expressed as the caller's id, not as a boolean the query
            // could aim at somebody else's collection.
            ...(query.savedOnly ? { savedByUserId: session.user.id } : {}),
          },
        },
        session.user.id,
      );

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/topics/:id',
    schema: {
      operationId: 'getTopic',
      tags: ['topics'],
      summary: 'Get one topic with its score breakdowns, snapshots and top posts',
      description:
        'The snapshot series is cut to `range` so the detail view loads only the window its chart draws, rather than the topic’s entire history.',
      params: idParamSchema,
      querystring: topicTrendQuerySchema,
      response: {
        200: successEnvelope(topicDetailSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const window = windowForRange(request.query.range, new Date());

      const topic = await repositories.topics.findDetailById(request.params.id, {
        userId: session.user.id,
        snapshotsFrom: window.from,
      });
      if (topic === null) throw new NotFoundError('Topic');
      return ok(topic);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/topics/:id',
    schema: {
      operationId: 'updateTopic',
      tags: ['topics'],
      summary: 'Archive or restore a topic, or edit its summary',
      description:
        'Archiving is reversible and destroys nothing: an archived topic keeps its posts and its history, and is simply excluded from the default list.',
      params: idParamSchema,
      body: updateTopicBodySchema,
      response: {
        200: successEnvelope(topicSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const { id } = request.params;
      const body = request.body;

      // No existence check first: the repository maps Prisma's missing-record
      // error to the same 404, so a pre-read would only widen the window in
      // which the topic can disappear between the check and the write.
      if (body.summary !== undefined) {
        // An empty summary clears the field. The column is nullable and the
        // editor submits an empty box to mean "there is no summary", which is
        // not the same thing as a summary that is the empty string.
        await repositories.topics.updateSummary(
          id,
          body.summary.length === 0 ? null : body.summary,
        );
      }
      if (body.status !== undefined) {
        await repositories.topics.setStatus(id, body.status);
      }

      // Re-read rather than return what `setStatus` handed back: that row is
      // mapped without source kinds or the caller's saved flag, and the client
      // replaces a listed topic with this response.
      const updated = await repositories.topics.findById(id, session.user.id);
      if (updated === null) throw new NotFoundError('Topic');
      return ok(updated);
    },
  });

  app.route({
    method: 'GET',
    url: '/topics/:id/posts',
    schema: {
      operationId: 'listTopicPosts',
      tags: ['topics'],
      summary: 'List the posts clustered into one topic',
      params: idParamSchema,
      querystring: topicPostsQuerySchema,
      response: {
        200: paginatedEnvelope(postSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const { id } = request.params;
      const query = request.query;

      // An unknown topic must answer 404, not an empty page: the two are
      // indistinguishable to a client, and only one of them is worth retrying.
      const topic = await repositories.topics.findById(id);
      if (topic === null) throw new NotFoundError('Topic');

      const result = await repositories.posts.list({
        pagination: { page: query.page, pageSize: query.pageSize },
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        filters: {
          topicId: id,
          ...(query.sources === undefined ? {} : { sources: query.sources }),
          ...(query.languages === undefined ? {} : { languages: query.languages }),
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
    url: '/topics/:id/trend',
    schema: {
      operationId: 'getTopicTrend',
      tags: ['topics'],
      summary: 'The trend snapshot series behind a topic’s chart',
      description:
        'Snapshots are recorded oldest first over the requested range. Fewer points than the range suggests means the topic was not being scored yet, not that data is missing.',
      params: idParamSchema,
      querystring: topicTrendQuerySchema,
      response: {
        200: successEnvelope(topicTrendSeriesSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const window = windowForRange(request.query.range, new Date());

      // `postLimit: 1` declines the page of posts the detail loader always
      // fetches: the chart draws none of them, and the loader has no mode that
      // skips them entirely.
      const topic = await repositories.topics.findDetailById(request.params.id, {
        userId: session.user.id,
        snapshotsFrom: window.from,
        postLimit: 1,
      });
      if (topic === null) throw new NotFoundError('Topic');

      return ok({ topicId: topic.id, topicName: topic.name, snapshots: topic.snapshots });
    },
  });

  app.route({
    method: 'GET',
    url: '/trends',
    schema: {
      operationId: 'listTrends',
      tags: ['trends'],
      summary: 'The trending topics behind the dashboard widget',
      description:
        'Ranked by the current trend score, which already folds in velocity and freshness, so the list answers "what is moving now" without a range being applied to it.',
      querystring: trendsQuerySchema,
      response: {
        200: successEnvelope(readonlyArray(topicSchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const topics = await repositories.topics.findTrending(request.query.limit, session.user.id);
      return ok(topics);
    },
  });

  app.route({
    method: 'GET',
    url: '/trends/emerging',
    schema: {
      operationId: 'listEmergingTrends',
      tags: ['trends'],
      summary: 'Topics accelerating faster than their volume alone would explain',
      description:
        'Ordered by velocity rather than by trend score, because the point of the panel is what is rising, not what is already large. Each topic carries the signals that earned it the classification.',
      querystring: trendsQuerySchema,
      response: {
        200: successEnvelope(readonlyArray(topicSchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const topics = await repositories.topics.findByClassification(
        'EMERGING_TREND',
        request.query.limit,
      );
      return ok(topics);
    },
  });

  app.route({
    method: 'GET',
    url: '/trends/hidden-gems',
    schema: {
      operationId: 'listHiddenGems',
      tags: ['trends'],
      summary: 'Topics discussed in English with little Arabic coverage',
      description:
        'Ordered by the Arabic opportunity score: high English volume against Arabic scarcity is the gap this product exists to surface.',
      querystring: trendsQuerySchema,
      response: {
        200: successEnvelope(readonlyArray(topicSchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const topics = await repositories.topics.findByClassification(
        'HIDDEN_GEM',
        request.query.limit,
      );
      return ok(topics);
    },
  });

  return Promise.resolve();
};
