import { NotFoundError, ValidationError } from '@trendhunter/shared';
import type { ContentLanguage, TerminologyPreference, TranslationMode } from '@trendhunter/types';
import {
  createTranslationBodySchema,
  idParamSchema,
  listTranslationsQuerySchema,
  updateTranslationBodySchema,
  type CreateTranslationBody,
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
import { translationSchema } from '../http/schemas';

/**
 * Translations.
 *
 * Everything here is user-owned: a translation records what one person asked
 * for, in their mode and with their terminology, so every repository call is
 * scoped by the caller's id and nothing is loaded by id alone.
 *
 * Creation is the only endpoint in this module that spends money. It is rate
 * limited as expensive, it reuses an existing translation whenever one exists,
 * and it does the work in the request rather than enqueuing it — a translation
 * is something the user is waiting to read, not a background job.
 */

/** Separator between a post's title and its body, and between thread posts. */
const PARAGRAPH_BREAK = '\n\n';

/** The columns that link a translation back to whatever it translated. */
interface TranslationLinks {
  readonly postId: string | null;
  readonly commentId: string | null;
  readonly threadId: string | null;
  readonly topicId: string | null;
}

const NO_LINKS: TranslationLinks = {
  postId: null,
  commentId: null,
  threadId: null,
  topicId: null,
};

interface ResolvedTarget {
  readonly links: TranslationLinks;
  /** The text exactly as it will be stored on the translation record. */
  readonly sourceContent: string;
  /** Set only for a thread, which is translated as a whole rather than as text. */
  readonly thread: { readonly title: string; readonly posts: readonly string[] } | null;
}

/** What the two translation services agree on, once their results are unified. */
interface TranslationOutcome {
  readonly translatedContent: string;
  readonly sourceLanguage: ContentLanguage;
  readonly preservedTerms: readonly string[];
  readonly explanation: string;
  readonly providerName: string;
}

/**
 * The body's refinement guarantees a `targetId` for every kind but `FREEFORM`,
 * but it does so at runtime, so the compiler still needs this narrowing.
 */
function targetIdOf(body: CreateTranslationBody): string {
  if (body.targetId === undefined) {
    throw new ValidationError('targetId is required for this target kind.');
  }
  return body.targetId;
}

export const translationRoutes: RouteModule = (app) => {
  const { repositories, services } = app.container;

  /**
   * Loads whatever is being translated, and the ids that will point back at it.
   *
   * The user-owned targets are loaded through a method that takes the user id,
   * so a caller cannot translate — and thereby read — another user's thread.
   */
  async function resolveTarget(
    userId: string,
    body: CreateTranslationBody,
  ): Promise<ResolvedTarget> {
    switch (body.targetKind) {
      case 'POST': {
        const post = await repositories.posts.findById(targetIdOf(body));
        if (post === null) throw new NotFoundError('Post');
        return {
          links: { ...NO_LINKS, postId: post.id },
          sourceContent:
            post.title === null ? post.content : `${post.title}${PARAGRAPH_BREAK}${post.content}`,
          thread: null,
        };
      }
      case 'THREAD': {
        const thread = await repositories.content.findThread(userId, targetIdOf(body));
        if (thread === null) throw new NotFoundError('Thread');
        const posts = thread.posts.map((post) => post.content);
        return {
          links: { ...NO_LINKS, threadId: thread.id },
          sourceContent: posts.join(PARAGRAPH_BREAK),
          thread: { title: thread.title, posts },
        };
      }
      case 'TOPIC': {
        const topic = await repositories.topics.findById(targetIdOf(body));
        if (topic === null) throw new NotFoundError('Topic');
        return {
          links: { ...NO_LINKS, topicId: topic.id },
          sourceContent:
            topic.summary === null ? topic.name : `${topic.name}${PARAGRAPH_BREAK}${topic.summary}`,
          thread: null,
        };
      }
      case 'FREEFORM': {
        if (body.text === undefined) {
          throw new ValidationError('text is required when targetKind is FREEFORM.');
        }
        return { links: NO_LINKS, sourceContent: body.text, thread: null };
      }
      case 'COMMENT':
        // A comment is only ever read as part of its post, so there is no way
        // to fetch one by its own id. Translating the parent post instead would
        // quietly translate something other than what was asked for.
        throw new ValidationError(
          'A comment cannot be translated on its own; translate its post, or send the comment text as FREEFORM.',
        );
    }
  }

  async function runTranslation(
    target: ResolvedTarget,
    body: CreateTranslationBody,
    mode: TranslationMode,
    terminologyPreference: TerminologyPreference,
  ): Promise<TranslationOutcome> {
    const common = {
      targetLanguage: body.targetLanguage,
      mode,
      terminologyPreference,
      // Only an explicitly supplied source language is trusted. The stored
      // `language` column can be `OTHER`, which would reach the provider as the
      // language to translate from; the services detect from the text instead.
      ...(body.sourceLanguage === undefined ? {} : { sourceLanguage: body.sourceLanguage }),
    };

    if (target.thread !== null) {
      // A thread is translated as one narrative and cut back into posts
      // afterwards, never post by post: the cross-references, the hook and the
      // conclusion only survive when the model sees the whole thing at once.
      const result = await services.threadTranslator.translateThread({
        ...common,
        posts: target.thread.posts,
        title: target.thread.title,
      });
      return {
        translatedContent: result.posts.map((post) => post.content).join(PARAGRAPH_BREAK),
        sourceLanguage: result.sourceLanguage,
        preservedTerms: result.preservedTerms,
        explanation: result.explanation,
        providerName: result.providerName,
      };
    }

    const result = await services.translation.translate({
      ...common,
      text: target.sourceContent,
    });
    return {
      translatedContent: result.translatedText,
      sourceLanguage: result.sourceLanguage,
      preservedTerms: result.preservedTerms,
      explanation: result.explanation,
      providerName: result.providerName,
    };
  }

  app.route({
    method: 'POST',
    url: '/translations',
    config: expensive(app.container.env),
    schema: {
      operationId: 'createTranslation',
      tags: ['translations'],
      summary: 'Translate a post, topic, thread or arbitrary text',
      description:
        'Answers with the existing translation when the same post or thread has already been translated in the same mode, terminology and target language. `TOPIC` and `FREEFORM` are always translated afresh: a stored translation of those carries no id to match on. `mode` and `terminologyPreference` fall back to the settings of the calling user.',
      body: createTranslationBodySchema,
      response: {
        200: successEnvelope(translationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const userId = session.user.id;
      const body = request.body;

      // The defaults come from the user rather than from a constant: the mode
      // and the terminology preference are editorial choices someone made once
      // on the settings page and should not have to repeat per request.
      const settings = await repositories.users.loadSettings(userId);
      const mode = body.mode ?? settings.translationMode;
      const terminologyPreference = body.terminologyPreference ?? settings.terminologyPreference;

      const target = await resolveTarget(userId, body);

      // Translation is the most expensive operation in the product, so a repeat
      // request is answered from what has already been paid for. Only a target
      // with an id column can be matched this way: a FREEFORM or TOPIC
      // translation carries null in every link column, so the lookup would
      // return an unrelated translation of entirely different text.
      if (target.links.postId !== null || target.links.threadId !== null) {
        const existing = await repositories.content.findExistingTranslation({
          userId,
          targetKind: body.targetKind,
          postId: target.links.postId,
          commentId: target.links.commentId,
          threadId: target.links.threadId,
          mode,
          targetLanguage: body.targetLanguage,
        });
        // The repository keys the lookup on target, mode and target language
        // only, so a hit still has to be checked against the rest of the
        // request: a translation made under different terminology, or one
        // stored without the note this caller asked for, is not what was
        // ordered and is worth paying the provider again for.
        if (
          existing !== null &&
          existing.terminologyPreference === terminologyPreference &&
          (!body.explain || existing.explanation !== null)
        ) {
          return ok(existing);
        }
      }

      const outcome = await runTranslation(target, body, mode, terminologyPreference);

      return ok(
        await repositories.content.createTranslation({
          userId,
          targetKind: body.targetKind,
          postId: target.links.postId,
          commentId: target.links.commentId,
          threadId: target.links.threadId,
          topicId: target.links.topicId,
          sourceLanguage: outcome.sourceLanguage,
          targetLanguage: body.targetLanguage,
          mode,
          terminologyPreference,
          sourceContent: target.sourceContent,
          translatedContent: outcome.translatedContent,
          preservedTerms: outcome.preservedTerms,
          // The note is always produced; it is stored only when it was asked
          // for, so the Translations page does not carry commentary on
          // translations nobody wanted an explanation of.
          explanation: body.explain ? outcome.explanation : null,
          providerName: outcome.providerName,
        }),
      );
    },
  });

  app.route({
    method: 'GET',
    url: '/translations',
    schema: {
      operationId: 'listTranslations',
      tags: ['translations'],
      summary: "List the caller's translations",
      description:
        'Filtering is by target kind and mode. `search` is accepted by the schema but has no effect: stored translations carry no text index, so a text filter would have to scan every row.',
      querystring: listTranslationsQuerySchema,
      response: { 200: paginatedEnvelope(translationSchema), ...commonErrorResponses },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const query = request.query;

      const result = await repositories.content.listTranslations(session.user.id, {
        pagination: { page: query.page, pageSize: query.pageSize },
        ...(query.targetKind === undefined ? {} : { targetKind: query.targetKind }),
        ...(query.mode === undefined ? {} : { mode: query.mode }),
      });

      return paginated(result.items, result.pagination);
    },
  });

  app.route({
    method: 'GET',
    url: '/translations/:id',
    schema: {
      operationId: 'getTranslation',
      tags: ['translations'],
      summary: 'Get one translation',
      params: idParamSchema,
      response: {
        200: successEnvelope(translationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const translation = await repositories.content.findTranslation(
        session.user.id,
        request.params.id,
      );
      if (translation === null) throw new NotFoundError('Translation');
      return ok(translation);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/translations/:id',
    schema: {
      operationId: 'updateTranslation',
      tags: ['translations'],
      summary: 'Edit the translated text',
      description:
        'The human edit is the final word: it replaces the provider output in place rather than being stored beside it, because it is what the user will publish.',
      params: idParamSchema,
      body: updateTranslationBodySchema,
      response: {
        200: successEnvelope(translationSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const translation = await repositories.content.updateTranslation(
        session.user.id,
        request.params.id,
        request.body.translatedContent,
      );
      if (translation === null) throw new NotFoundError('Translation');
      return ok(translation);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/translations/:id',
    schema: {
      operationId: 'deleteTranslation',
      tags: ['translations'],
      summary: 'Delete a translation',
      params: idParamSchema,
      response: {
        204: z.null().describe('The translation was deleted.'),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const deleted = await repositories.content.deleteTranslation(
        session.user.id,
        request.params.id,
      );
      // A delete that matched nothing is a miss rather than a success: the
      // caller either never owned this translation or is deleting it twice, and
      // both are worth telling them about.
      if (!deleted) throw new NotFoundError('Translation');
      // Fastify drops the body for a 204, so the `null` only satisfies the
      // typed serialiser; nothing is written to the wire.
      return reply.code(204).send(null);
    },
  });

  return Promise.resolve();
};
