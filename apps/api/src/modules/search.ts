import {
  CONTENT_LANGUAGES,
  MAX_PAGE_SIZE,
  SEARCH_ENTITY_KINDS,
  SEARCH_MODES,
  type PaginationMeta,
} from '@trendhunter/types';
import { searchRequestSchema, searchSuggestionsQuerySchema } from '@trendhunter/validation';
import { z } from 'zod';

import { commonErrorResponses, ok, readonlyArray, successEnvelope } from '../http/envelope';
import { currentUser, expensive, type RouteModule } from '../http/route';
import { commentSchema, postSchema, registered, topicSchema } from '../http/schemas';

/**
 * Search.
 *
 * The service ranks; this module resolves. A ranked hit is only an id, a score
 * and a headline, so the ordering it produces is the one thing a naive
 * `findMany({ id: { in: ids } })` would throw away — every resolution below is
 * therefore re-sequenced against the hits rather than against the database's
 * own ordering.
 */

const searchResultSchema = registered(
  'SearchResult',
  z.object({
    id: z.string(),
    entity: z.enum(SEARCH_ENTITY_KINDS),
    /** 0..1 fused score, comparable only within one result set. */
    score: z.number(),
    keywordRank: z.number().nullable(),
    semanticRank: z.number().nullable(),
    headline: z.string().nullable(),
    post: postSchema.nullable(),
    topic: topicSchema.nullable(),
    comment: commentSchema
      .nullable()
      .describe(
        'Always null today: a comment hit carries only the comment id and no repository reads comments by id, so the object cannot be resolved. Declared so clients written against it keep working once a by-id reader exists.',
      ),
  }),
);

const searchResponseSchema = registered(
  'SearchResponse',
  z.object({
    query: z.string(),
    mode: z.enum(SEARCH_MODES),
    language: z.enum(CONTENT_LANGUAGES),
    /**
     * True when the vector arm was skipped because no query embedding could be
     * produced. It is reported rather than swallowed because the results are
     * genuinely different — keyword-only — and a user who searched for a
     * paraphrase and got nothing needs to be told why, instead of concluding
     * that nothing was collected.
     */
    degradedToKeyword: z.boolean(),
    results: readonlyArray(searchResultSchema),
  }),
);

const searchSuggestionSchema = registered(
  'SearchSuggestion',
  z.object({ value: z.string(), kind: z.enum(['topic', 'author']) }),
);

export const searchRoutes: RouteModule = (app) => {
  const { repositories, services } = app.container;

  app.route({
    method: 'GET',
    url: '/search',
    schema: {
      operationId: 'search',
      tags: ['search'],
      summary: 'Keyword, semantic or hybrid search',
      description:
        'Ranked hits are resolved to full objects in ranking order. `degradedToKeyword` is true when the embedding provider was unavailable and the vector arm was skipped, so the client can say so rather than silently showing keyword results for a semantic query. Relevance ranking has no cheap exact total, so page with `meta.pagination.hasNextPage`; `totalItems` and `totalPages` count only what has been reached.',
      querystring: searchRequestSchema,
      response: { 200: successEnvelope(searchResponseSchema), ...commonErrorResponses },
    },
    // Semantic and hybrid searches embed the query, which is a paid provider
    // call on every keystroke a careless client makes.
    config: expensive(app.container.env),
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;
      const offset = (query.page - 1) * query.pageSize;

      // One row past the page, which is the only honest way to know whether a
      // next page exists without re-running the fused query as a COUNT. At the
      // maximum page size the SQL layer clamps the extra row away, so the
      // page-came-back-full heuristic stands in there.
      const overFetch = query.pageSize < MAX_PAGE_SIZE;

      const outcome = await services.search.search({
        query: query.q,
        mode: query.mode,
        ...(query.entities === undefined ? {} : { entities: query.entities }),
        limit: overFetch ? query.pageSize + 1 : query.pageSize,
        offset,
        filters: {
          ...(query.sources === undefined ? {} : { sources: query.sources }),
          ...(query.languages === undefined ? {} : { languages: query.languages }),
          ...(query.topicId === undefined ? {} : { topicId: query.topicId }),
          ...(query.publishedFrom === undefined
            ? {}
            : { publishedFrom: new Date(query.publishedFrom) }),
          ...(query.publishedTo === undefined ? {} : { publishedTo: new Date(query.publishedTo) }),
          ...(query.minRelevance === undefined ? {} : { minRelevance: query.minRelevance }),
        },
      });

      const hasNextPage = overFetch
        ? outcome.hits.length > query.pageSize
        : outcome.hits.length === query.pageSize;
      const hits = outcome.hits.slice(0, query.pageSize);

      const idsOfEntity = (entity: (typeof SEARCH_ENTITY_KINDS)[number]): string[] =>
        hits.filter((hit) => hit.entity === entity).map((hit) => hit.id);

      const postIds = idsOfEntity('post');
      const topicIds = idsOfEntity('topic');

      const [posts, topics] = await Promise.all([
        repositories.posts.findManyInOrder(postIds),
        // The topic reader pages, so the page is sized to the hits; the saved
        // flag needs the caller because it is per-user state.
        topicIds.length === 0
          ? Promise.resolve([])
          : repositories.topics
              .list(
                {
                  filters: { ids: topicIds },
                  pagination: { page: 1, pageSize: topicIds.length },
                },
                session.user.id,
              )
              .then((result) => result.items),
      ]);

      // Both readers answer in their own order, so the hit order is reapplied
      // by lookup rather than by position.
      const postsById = new Map(posts.map((post) => [post.id, post]));
      const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

      const results = hits.map((hit) => ({
        id: hit.id,
        entity: hit.entity,
        score: hit.score,
        keywordRank: hit.keywordRank,
        semanticRank: hit.semanticRank,
        headline: hit.headline,
        post: postsById.get(hit.id) ?? null,
        topic: topicsById.get(hit.id) ?? null,
        // Comment hits stay unresolved: the comment reader is scoped by post
        // and a hit carries only the comment id, so there is no way to load one
        // without a by-id reader on the repository.
        comment: null,
      }));

      return ok(
        {
          query: query.q,
          mode: outcome.mode,
          language: outcome.language,
          degradedToKeyword: outcome.degradedToKeyword,
          results,
        },
        { pagination: searchPagination(query.page, query.pageSize, hits.length, hasNextPage) },
      );
    },
  });

  app.route({
    method: 'GET',
    url: '/search/suggestions',
    schema: {
      operationId: 'listSearchSuggestions',
      tags: ['search'],
      summary: 'Autocomplete suggestions for the search box',
      description:
        'Trigram-backed, so it answers a half-typed word that full-text search cannot match.',
      querystring: searchSuggestionsQuerySchema,
      response: {
        200: successEnvelope(readonlyArray(searchSuggestionSchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      currentUser(request);
      return ok(await services.search.suggest(request.query.q, request.query.limit));
    },
  });

  return Promise.resolve();
};

/**
 * Pagination meta for a ranked page.
 *
 * A relevance-ordered query has no cheap exact total: counting the matching set
 * means running the fused query again without a LIMIT, which doubles the cost
 * of every search to populate a number nobody pages to. `totalItems` and
 * `totalPages` therefore describe what has actually been reached rather than
 * what exists, and only `hasNextPage` — decided by the over-fetched row — is
 * exact. A client should page on `hasNextPage`, not on `totalPages`.
 */
function searchPagination(
  page: number,
  pageSize: number,
  hitCount: number,
  hasNextPage: boolean,
): PaginationMeta {
  const totalItems = (page - 1) * pageSize + hitCount;
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : hasNextPage ? page + 1 : page,
    hasNextPage,
    hasPreviousPage: page > 1,
  };
}
