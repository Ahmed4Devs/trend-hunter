import { NotFoundError, ValidationError } from '@trendhunter/shared';
import {
  createInterestBodySchema,
  idParamSchema,
  sourceConfigBodySchema,
  updateInterestBodySchema,
  updateSourceBodySchema,
} from '@trendhunter/validation';
import { z } from 'zod';

import {
  commonErrorResponses,
  notFoundResponse,
  ok,
  readonlyArray,
  successEnvelope,
} from '../http/envelope';
import { currentAdmin, currentUser, type RouteModule } from '../http/route';
import { interestSchema, sourceSchema } from '../http/schemas';

/**
 * Sources and interests.
 *
 * The two live together because they are the two halves of what the collector
 * reads: a source says where content comes from and is deployment-wide operator
 * configuration, an interest says what is worth surfacing and belongs to one
 * user. Only the reads of a source are shared — the dashboard shows whether a
 * provider is enabled and when it last ran — and every write is administrator
 * only.
 */

/**
 * One stored provider setting.
 *
 * `value` is genuinely provider-specific (a subreddit list, a feed URL array, a
 * comment limit), so it is declared as unknown rather than pretending to a
 * shape; the discriminated union in `@trendhunter/validation` is what guarantees
 * it was checked before it was written.
 */
const sourceConfigEntrySchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.iso.datetime(),
});
z.globalRegistry.add(sourceConfigEntrySchema, { id: 'SourceConfigEntry' });

export const sourceRoutes: RouteModule = (app) => {
  const { repositories } = app.container;

  app.route({
    method: 'GET',
    url: '/sources',
    schema: {
      operationId: 'listSources',
      tags: ['sources'],
      summary: 'List the configured providers',
      description:
        'Readable by any signed-in caller: the dashboard reports which providers are enabled and when each was last scanned. The provider settings themselves are not included.',
      response: {
        200: successEnvelope(readonlyArray(sourceSchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      currentUser(request);
      return ok(await repositories.sources.list());
    },
  });

  app.route({
    method: 'GET',
    url: '/sources/:id',
    schema: {
      operationId: 'getSource',
      tags: ['sources'],
      summary: 'Get one provider',
      params: idParamSchema,
      response: {
        200: successEnvelope(sourceSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentUser(request);
      const source = await repositories.sources.findById(request.params.id);
      if (source === null) throw new NotFoundError('Source');
      return ok(source);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/sources/:id',
    schema: {
      operationId: 'updateSource',
      tags: ['sources'],
      summary: 'Enable, weight or reschedule a provider',
      description:
        'The scan interval is enforced by the collector, so shortening it here is what makes a provider poll more often — and what can exhaust its rate limit.',
      params: idParamSchema,
      body: updateSourceBodySchema,
      response: {
        200: successEnvelope(sourceSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentAdmin(request);
      const { id } = request.params;
      const body = request.body;

      // The repository already maps Prisma P2025 onto NotFoundError, so this read
      // is not what produces the 404. It is what keeps the answer independent of
      // the driver error codes, and what stops a blind write against an id that
      // never existed.
      const source = await repositories.sources.findById(id);
      if (source === null) throw new NotFoundError('Source');

      return ok(
        await repositories.sources.update(id, {
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          ...(body.authorityWeight === undefined ? {} : { authorityWeight: body.authorityWeight }),
          ...(body.scanIntervalMinutes === undefined
            ? {}
            : { scanIntervalMinutes: body.scanIntervalMinutes }),
        }),
      );
    },
  });

  app.route({
    method: 'GET',
    url: '/sources/:id/config',
    schema: {
      operationId: 'getSourceConfig',
      tags: ['sources'],
      summary: 'Read a provider configuration',
      description:
        'Administrator only. The stored settings name the subreddits, queries and feed URLs an operator chose, which is not something every signed-in caller should be able to enumerate.',
      params: idParamSchema,
      response: {
        200: successEnvelope(readonlyArray(sourceConfigEntrySchema)),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentAdmin(request);
      const source = await repositories.sources.findById(request.params.id);
      if (source === null) throw new NotFoundError('Source');
      return ok(await repositories.sources.listConfigs(source.id));
    },
  });

  app.route({
    method: 'PUT',
    url: '/sources/:id/config',
    schema: {
      operationId: 'replaceSourceConfig',
      tags: ['sources'],
      summary: 'Replace a provider configuration',
      description:
        'Administrator only. The body is validated per provider, and its `kind` must match the target source. Settings absent from the body are removed.',
      params: idParamSchema,
      body: sourceConfigBodySchema,
      response: {
        200: successEnvelope(readonlyArray(sourceConfigEntrySchema)),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      currentAdmin(request);
      const source = await repositories.sources.findById(request.params.id);
      if (source === null) throw new NotFoundError('Source');

      const { kind, ...entries } = request.body;

      // The union validates the body against *a* provider, not against *this*
      // one. Storing a Reddit configuration on the RSS source would pass schema
      // validation and then break collection silently, because the connector
      // would find none of the keys it reads.
      if (kind !== source.kind) {
        throw new ValidationError('The configuration does not match this source.', {
          details: { expected: source.kind, received: kind },
        });
      }

      // Replaced rather than merged: the configuration is edited as one form,
      // and a leftover key from a previous shape would keep reaching the
      // connector.
      await repositories.sources.replaceConfig(source.id, entries);

      return ok(await repositories.sources.listConfigs(source.id));
    },
  });

  app.route({
    method: 'GET',
    url: '/interests',
    schema: {
      operationId: 'listInterests',
      tags: ['interests'],
      summary: "List the caller's interests",
      response: {
        200: successEnvelope(readonlyArray(interestSchema)),
        ...commonErrorResponses,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      return ok(await repositories.interests.listForUser(session.user.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/interests',
    schema: {
      operationId: 'createInterest',
      tags: ['interests'],
      summary: 'Create an interest',
      description:
        'The interest starts with no centroid embedding, so until the embeddings worker builds one it contributes to relevance through its keywords alone.',
      body: createInterestBodySchema,
      response: {
        201: successEnvelope(interestSchema),
        ...commonErrorResponses,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const body = request.body;

      const interest = await repositories.interests.create(session.user.id, {
        name: body.name,
        ...(body.description === undefined ? {} : { description: body.description }),
        weight: body.weight,
        enabled: body.enabled,
        keywords: body.keywords,
      });

      return reply.code(201).send(ok(interest));
    },
  });

  app.route({
    method: 'GET',
    url: '/interests/:id',
    schema: {
      operationId: 'getInterest',
      tags: ['interests'],
      summary: 'Get one interest',
      params: idParamSchema,
      response: {
        200: successEnvelope(interestSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      // Scoped to the owner in the query, so another user's interest is a 404
      // and its existence is never confirmed.
      const interest = await repositories.interests.findForUser(session.user.id, request.params.id);
      if (interest === null) throw new NotFoundError('Interest');
      return ok(interest);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/interests/:id',
    schema: {
      operationId: 'updateInterest',
      tags: ['interests'],
      summary: 'Update an interest',
      description:
        'Editing the name, description or keywords invalidates the interest centroid embedding. The embeddings worker rebuilds it on its next pass, so relevance scores shift shortly after the edit rather than immediately.',
      params: idParamSchema,
      body: updateInterestBodySchema,
      response: {
        200: successEnvelope(interestSchema),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request) => {
      const session = currentUser(request);
      const body = request.body;

      const interest = await repositories.interests.update(session.user.id, request.params.id, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.weight === undefined ? {} : { weight: body.weight }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.keywords === undefined ? {} : { keywords: body.keywords }),
      });
      if (interest === null) throw new NotFoundError('Interest');

      return ok(interest);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/interests/:id',
    schema: {
      operationId: 'deleteInterest',
      tags: ['interests'],
      summary: 'Delete an interest',
      description:
        'Its keywords go with it, and posts already scored against it keep the score they were given: relevance is recomputed on the next scoring pass, not retroactively.',
      params: idParamSchema,
      response: {
        204: z.null().describe('The interest was deleted.'),
        ...commonErrorResponses,
        ...notFoundResponse,
      },
    },
    handler: async (request, reply) => {
      const session = currentUser(request);
      const deleted = await repositories.interests.delete(session.user.id, request.params.id);
      if (!deleted) throw new NotFoundError('Interest');
      return reply.code(204).send(null);
    },
  });

  return Promise.resolve();
};
