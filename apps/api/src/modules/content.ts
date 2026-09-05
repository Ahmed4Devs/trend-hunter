import { characterBudgetFor, type DraftResult } from '@trendhunter/content';
import {
  NotFoundError,
  ValidationError,
  X_LONG_POST_CHARACTER_LIMIT,
  characterCount,
  truncate,
} from '@trendhunter/shared';
import {
  CONTENT_TONES,
  type ContentDraft,
  type ContentTone,
  type GenerationContext,
  type Post,
} from '@trendhunter/types';
import {
  createThreadBodySchema,
  generateContentBodySchema,
  idParamSchema,
  listContentDraftsQuerySchema,
  listThreadsQuerySchema,
  rewriteContentBodySchema,
  translateThreadBodySchema,
  updateContentDraftBodySchema,
  updateThreadBodySchema,
} from '@trendhunter/validation';
import { z } from 'zod';

import {
  commonErrorResponses,
  notFoundResponse,
  ok,
  paginated,
  paginatedEnvelope,
  successEnvelope,
} from '../http/envelope';
import { currentUser, expensive, type RouteModule } from '../http/route';
import { contentDraftSchema, threadSchema, translationSchema } from '../http/schemas';

/**
 * The Content Studio and X threads.
 *
 * Everything here is user-owned, so every read and every write goes through a
 * repository method that takes the caller's id and scopes the query itself —
 * there is no "load, then compare owners", which is the shape that leaks
 * another user's draft the day someone adds a path that forgets the compare.
 *
 * Generation, rewriting and translation all spend a provider quota, so they
 * carry the expensive rate limit. The work is done in the request rather than
 * enqueued because the user is waiting on the text and has nowhere to put a
 * job id.
 */

/** Excerpts handed to the model as evidence. Enough to ground a claim. */
const CONTEXT_EXCERPT_COUNT = 5;

/** Characters of an untitled post's body used as a stand-in topic name. */
const POST_NAME_FALLBACK_CHARACTERS = 120;

/**
 * Separator for the stored translation record.
 *
 * A thread is translated as one narrative, so the record holds one narrative:
 * the posts joined by blank lines, which is the text the translator was given
 * and the text it produced.
 */
const NARRATIVE_SEPARATOR = '\n\n';

/** 204 carries no body; the schema is here so the document says so. */
const noContentResponse = {
  204: z.null().describe('The resource was deleted.'),
} as const;

export const contentRoutes: RouteModule = (app) => {
  const { env, repositories, services } = app.container;

  app.route({
    method: 'POST',
    url: '/content/generate',
    config: expensive(env),
    schema: {
      operationId: 'generateContent',
      tags: ['content'],
      summary: 'Generate a draft, or a thread, from a topic or a post',
      description:
        'A thread is a different resource from a single draft — it is stored with its posts and has its own endpoints — so the payload is a thread when `kind` is `X_THREAD` and a content draft otherwise.',
      body: generateContentBodySchema,
      response: {
        201: successEnvelope(z.union([contentDraftSchema, threadSchema])),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;
      const anchor = await buildAnchor(session.user.id, body.topicId, body.postId);

      // `maxCharacters` and `instructions` are accepted by the request schema
      // but there is nothing to pass them to: the studio's public API takes a
      // language and a tone, and folding free user text into the brief here
      // would place it beside third-party excerpts inside the prompt.
      if (body.kind === 'X_THREAD') {
        const thread = await services.threads.generateThread(anchor.context, {
          language: body.language,
          tone: body.tone,
          ...(body.threadLength === undefined ? {} : { length: body.threadLength }),
        });
        const created = await repositories.content.createThread({
          userId: session.user.id,
          topicId: anchor.topicId,
          title: thread.title,
          language: thread.language,
          posts: thread.posts,
        });
        return reply.code(201).send(ok(created));
      }

      const draft = await services.content.generateDraft(body.kind, anchor.context, {
        language: body.language,
        tone: body.tone,
      });
      return reply.code(201).send(ok(await persistDraft(session.user.id, anchor, draft)));
    },
  });

  app.route({
    method: 'GET',
    url: '/content/drafts',
    schema: {
      operationId: 'listContentDrafts',
      tags: ['content'],
      summary: "List the caller's content drafts",
      querystring: listContentDraftsQuerySchema,
      response: { 200: paginatedEnvelope(contentDraftSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;

      const result = await repositories.content.listDrafts(session.user.id, {
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.topicId === undefined ? {} : { topicId: query.topicId }),
        savedOnly: query.savedOnly,
      });

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/content/drafts/:id',
    schema: {
      operationId: 'getContentDraft',
      tags: ['content'],
      summary: 'Get one content draft',
      params: idParamSchema,
      response: {
        200: successEnvelope(contentDraftSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      return ok(await requireDraft(session.user.id, request.params.id));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/content/drafts/:id',
    schema: {
      operationId: 'updateContentDraft',
      tags: ['content'],
      summary: 'Edit a content draft',
      params: idParamSchema,
      body: updateContentDraftBodySchema,
      response: {
        200: successEnvelope(contentDraftSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const body = request.body;

      const updated = await repositories.content.updateDraft(session.user.id, request.params.id, {
        ...(body.title === undefined ? {} : { title: body.title }),
        // The count is recomputed rather than carried over: it is what thread
        // splitting and the X limit are checked against downstream, and a
        // browser counts UTF-16 units where X counts code points, so a stale
        // count would shift every later post boundary in a thread.
        ...(body.content === undefined
          ? {}
          : { content: body.content, characterCount: characterCount(body.content) }),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.isSaved === undefined ? {} : { isSaved: body.isSaved }),
      });
      if (updated === null) throw new NotFoundError('Content draft');

      return ok(updated);
    },
  });

  app.route({
    method: 'POST',
    url: '/content/drafts/:id/rewrite',
    config: expensive(env),
    schema: {
      operationId: 'rewriteContentDraft',
      tags: ['content'],
      summary: 'Shorten, expand, rewrite or retone a draft',
      description:
        'The result is stored as a new draft rather than replacing the original: an expansion promotes a short post to a long one and a retone changes the tone, neither of which an edit records, and keeping the original is what makes a rewrite the user dislikes recoverable.',
      params: idParamSchema,
      body: rewriteContentBodySchema,
      response: {
        201: successEnvelope(contentDraftSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;

      const draft = await requireDraft(session.user.id, request.params.id);
      const anchor = await buildAnchor(session.user.id, draft.topicId, draft.postId);
      const source = toDraftResult(draft, anchor.context, body.targetCharacters);
      const options = body.tone === undefined ? {} : { tone: body.tone };

      const rewritten = await applyOperation();
      return reply.code(201).send(ok(await persistDraft(session.user.id, anchor, rewritten)));

      function applyOperation(): Promise<DraftResult> {
        switch (body.operation) {
          case 'shorten':
            return services.content.shorten(source, options);
          case 'expand':
            return services.content.expand(source, options);
          case 'changeTone':
            if (body.tone === undefined) {
              throw new ValidationError('`tone` is required when the operation is `changeTone`.');
            }
            return services.content.changeTone(source, body.tone);
          case 'rewrite':
            return services.content.rewrite(source, options);
        }
      }
    },
  });

  app.route({
    method: 'POST',
    url: '/content/drafts/:id/regenerate',
    config: expensive(env),
    schema: {
      operationId: 'regenerateContentDraft',
      tags: ['content'],
      summary: 'Write a different take on the same brief',
      description:
        'Stored as a new draft so the two takes can be compared; the original is left untouched.',
      params: idParamSchema,
      response: {
        201: successEnvelope(contentDraftSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const draft = await requireDraft(session.user.id, request.params.id);
      const anchor = await buildAnchor(session.user.id, draft.topicId, draft.postId);

      const regenerated = await services.content.regenerate(
        toDraftResult(draft, anchor.context, undefined),
      );
      return reply.code(201).send(ok(await persistDraft(session.user.id, anchor, regenerated)));
    },
  });

  app.route({
    method: 'DELETE',
    url: '/content/drafts/:id',
    schema: {
      operationId: 'deleteContentDraft',
      tags: ['content'],
      summary: 'Delete a content draft',
      params: idParamSchema,
      response: { ...noContentResponse, ...commonErrorResponses, ...notFoundResponse },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const deleted = await repositories.content.deleteDraft(session.user.id, request.params.id);
      if (!deleted) throw new NotFoundError('Content draft');
      return reply.code(204).send(null);
    },
  });

  app.route({
    method: 'POST',
    url: '/threads',
    config: expensive(env),
    schema: {
      operationId: 'createThread',
      tags: ['threads'],
      summary: 'Generate an X thread from a topic or a post',
      body: createThreadBodySchema,
      response: {
        201: successEnvelope(threadSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;
      const anchor = await buildAnchor(session.user.id, body.topicId, body.postId);

      const options = {
        language: body.language,
        tone: body.tone,
        ...(body.length === undefined ? {} : { length: body.length }),
      };
      // Anchoring on a post means the user wants that post expanded — its claim
      // and its facts carried into the thread — not a fresh thread about the
      // topic it happens to have been clustered into.
      const thread =
        anchor.post === null
          ? await services.threads.generateThread(anchor.context, options)
          : await services.threads.threadFromPost(
              { content: anchor.post.content, context: anchor.context },
              options,
            );

      const created = await repositories.content.createThread({
        userId: session.user.id,
        topicId: anchor.topicId,
        title: body.title ?? thread.title,
        language: thread.language,
        posts: thread.posts,
      });
      return reply.code(201).send(ok(created));
    },
  });

  app.route({
    method: 'GET',
    url: '/threads',
    schema: {
      operationId: 'listThreads',
      tags: ['threads'],
      summary: "List the caller's threads",
      querystring: listThreadsQuerySchema,
      response: { 200: paginatedEnvelope(threadSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;

      const result = await repositories.content.listThreads(session.user.id, {
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.topicId === undefined ? {} : { topicId: query.topicId }),
        savedOnly: query.savedOnly,
      });

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/threads/:id',
    schema: {
      operationId: 'getThread',
      tags: ['threads'],
      summary: 'Get one thread with its posts',
      params: idParamSchema,
      response: {
        200: successEnvelope(threadSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const thread = await repositories.content.findThread(session.user.id, request.params.id);
      if (thread === null) throw new NotFoundError('Thread');
      return ok(thread);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/threads/:id',
    schema: {
      operationId: 'updateThread',
      tags: ['threads'],
      summary: 'Edit a thread, replacing its posts',
      params: idParamSchema,
      body: updateThreadBodySchema,
      response: {
        200: successEnvelope(threadSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const body = request.body;

      // The repository replaces the posts under a unique `(threadId, position)`
      // index, so a duplicate position would surface as a conflict about a
      // constraint the caller has never heard of — and 409 is not one of the
      // answers this endpoint documents.
      if (
        body.posts !== undefined &&
        new Set(body.posts.map((post) => post.position)).size !== body.posts.length
      ) {
        throw new ValidationError('Thread post positions must be unique.');
      }

      const updated = await repositories.content.updateThread(session.user.id, request.params.id, {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.isSaved === undefined ? {} : { isSaved: body.isSaved }),
        // Counts are computed here and never taken from the client: a browser
        // reports UTF-16 units, and every check that matters — the per-post
        // budget, the room reserved for the counter, the X limit — counts code
        // points, so a client count would understate a post full of emoji and
        // Arabic and let an unpublishable one through.
        ...(body.posts === undefined
          ? {}
          : {
              posts: body.posts.map((post) => ({
                position: post.position,
                content: post.content,
                characterCount: characterCount(post.content),
              })),
            }),
      });
      if (updated === null) throw new NotFoundError('Thread');

      return ok(updated);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/threads/:id',
    schema: {
      operationId: 'deleteThread',
      tags: ['threads'],
      summary: 'Delete a thread',
      params: idParamSchema,
      response: { ...noContentResponse, ...commonErrorResponses, ...notFoundResponse },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const deleted = await repositories.content.deleteThread(session.user.id, request.params.id);
      if (!deleted) throw new NotFoundError('Thread');
      return reply.code(204).send(null);
    },
  });

  app.route({
    method: 'POST',
    url: '/threads/:id/translate',
    config: expensive(env),
    schema: {
      operationId: 'translateThread',
      tags: ['threads'],
      summary: 'Translate a whole thread',
      description:
        'The thread is translated as one narrative and cut back into posts afterwards, so cross-references, the hook and the closing payoff survive.',
      params: idParamSchema,
      body: translateThreadBodySchema,
      response: {
        201: successEnvelope(translationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;

      const thread = await repositories.content.findThread(session.user.id, request.params.id);
      if (thread === null) throw new NotFoundError('Thread');

      // The mode and the terminology preference are editorial choices someone
      // made once on the settings page, so they are read from there rather than
      // demanded on every request — this is the same resolution `POST
      // /translations` performs, and both endpoints write the same table.
      const settings = await repositories.users.loadSettings(session.user.id);
      const mode = body.mode ?? settings.translationMode;
      const terminologyPreference = body.terminologyPreference ?? settings.terminologyPreference;

      // The whole thread goes in one call. Translating post by post is the
      // obvious implementation and it is wrong: post four says "this" and means
      // the benchmark from post two, and Arabic marks gender on the pronoun, so
      // a translator that cannot see post two guesses — in every sentence. The
      // hook stops opening anything, the last post stops paying off a promise
      // it can no longer see, and independent calls pick independent renderings
      // of the same term. So what is stored below is one translation of one
      // narrative rather than a bag of per-post fragments.
      const posts = thread.posts.map((post) => post.content);
      const translated = await services.threadTranslator.translateThread({
        posts,
        targetLanguage: body.targetLanguage,
        title: thread.title,
        // `OTHER` is a bucket rather than a language a translator can be told
        // to read from, so detection is left to do the job in that case.
        ...(thread.language === 'OTHER' ? {} : { sourceLanguage: thread.language }),
        mode,
        terminologyPreference,
      });

      const translation = await repositories.content.createTranslation({
        userId: session.user.id,
        targetKind: 'THREAD',
        threadId: thread.id,
        topicId: thread.topicId,
        sourceLanguage: translated.sourceLanguage,
        targetLanguage: translated.targetLanguage,
        mode: translated.mode,
        terminologyPreference,
        sourceContent: posts.join(NARRATIVE_SEPARATOR),
        translatedContent: translated.posts.map((post) => post.content).join(NARRATIVE_SEPARATOR),
        preservedTerms: translated.preservedTerms,
        explanation: translated.explanation,
        providerName: translated.providerName,
      });

      return reply.code(201).send(ok(translation));
    },
  });

  return Promise.resolve();

  async function requireDraft(userId: string, id: string): Promise<ContentDraft> {
    const draft = await repositories.content.findDraft(userId, id);
    if (draft === null) throw new NotFoundError('Content draft');
    return draft;
  }

  /**
   * Resolves what a generation is about.
   *
   * A brief is only as good as its evidence, so this gathers the topic summary,
   * the strongest posts under that topic, the interests the user actually has
   * switched on, and the Arabic opportunity score — the last of which is what
   * makes the studio propose Arabic content for a genuine gap rather than for a
   * subject that is already saturated in Arabic.
   */
  async function buildAnchor(
    userId: string,
    requestedTopicId: string | undefined | null,
    requestedPostId: string | undefined | null,
  ): Promise<{ context: GenerationContext; topicId: string | null; post: Post | null }> {
    const post =
      requestedPostId == null ? null : await repositories.posts.findById(requestedPostId);
    if (requestedPostId != null && post === null) throw new NotFoundError('Post');

    // A clustered post carries its topic, which is what lets a post-anchored
    // draft get the same summary and opportunity score a topic-anchored one
    // gets. A missing topic is only an error when the caller named it.
    const topicId = requestedTopicId ?? post?.topicId ?? null;
    const topic = topicId === null ? null : await repositories.topics.findById(topicId, userId);
    if (requestedTopicId != null && topic === null) throw new NotFoundError('Topic');

    const interests = await repositories.interests.listForUser(userId);

    return {
      topicId: topic?.id ?? null,
      post,
      context: {
        topicName:
          topic?.name ??
          post?.title ??
          (post === null ? '' : truncate(post.content, POST_NAME_FALLBACK_CHARACTERS)),
        topicSummary: topic?.summary ?? null,
        sourceExcerpts: await sourceExcerpts(topic?.id ?? null, post),
        // Disabled interests are excluded deliberately: they are the ones the
        // user has told us not to write about.
        interests: interests
          .filter((interest) => interest.enabled)
          .map((interest) => interest.name),
        arabicOpportunityScore: topic?.arabicOpportunityScore ?? null,
      },
    };
  }

  /**
   * The posts the model is shown as evidence.
   *
   * Ranked by trend score rather than recency: the brief needs the posts
   * carrying the conversation, and the newest post under a topic is very often
   * a one-line reaction to it. The anchor post always leads, because it is the
   * thing the user pointed at.
   */
  async function sourceExcerpts(topicId: string | null, post: Post | null): Promise<string[]> {
    if (topicId === null) return post === null ? [] : [post.content];

    const result = await repositories.posts.list({
      pagination: { page: 1, pageSize: CONTEXT_EXCERPT_COUNT },
      sortBy: 'trendScore',
      sortDirection: 'desc',
      filters: { topicId },
    });

    return [
      ...(post === null ? [] : [post]),
      ...result.items.filter((item) => item.id !== post?.id),
    ]
      .slice(0, CONTEXT_EXCERPT_COUNT)
      .map((item) => item.content);
  }

  function persistDraft(
    userId: string,
    anchor: { topicId: string | null; post: Post | null },
    draft: DraftResult,
  ): Promise<ContentDraft> {
    return repositories.content.createDraft({
      userId,
      kind: draft.kind,
      language: draft.language,
      title: draft.title,
      content: draft.content,
      characterCount: draft.characterCount,
      tone: draft.tone,
      providerName: draft.providerName,
      topicId: anchor.topicId,
      postId: anchor.post?.id ?? null,
    });
  }
};

/**
 * Rebuilds the studio's own draft representation from a stored one.
 *
 * The brief a draft was written from is not persisted — it is derived from the
 * topic and the post, both of which are — so a rewrite reconstructs it here
 * rather than asking the client to send it back, which would let a caller
 * rewrite their draft against evidence of their own choosing.
 */
function toDraftResult(
  draft: ContentDraft,
  context: GenerationContext,
  targetCharacters: number | undefined,
): DraftResult {
  return {
    kind: draft.kind,
    language: draft.language,
    tone: toContentTone(draft.tone),
    title: draft.title,
    content: draft.content,
    characterCount: draft.characterCount,
    // `targetCharacters` only bites on a plain rewrite or a tone change:
    // shortening and expanding derive their target from the draft's current
    // length, because a shorten that came back longer would not be a shorten.
    characterBudget:
      targetCharacters ?? characterBudgetFor(draft.kind) ?? X_LONG_POST_CHARACTER_LIMIT,
    trimmed: false,
    providerName: draft.providerName,
    // Not persisted, and nothing on the rewrite path reads it — the result that
    // comes back carries the model that actually answered.
    providerModel: '',
    angle: null,
    context,
  };
}

/** The stored tone is a free string; an unrecognised one falls back to neutral. */
function toContentTone(value: string | null): ContentTone {
  return CONTENT_TONES.find((tone) => tone === value) ?? 'NEUTRAL';
}
