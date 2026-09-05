import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { ApiEnvironment } from '@trendhunter/env';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

/**
 * OpenAPI documentation.
 *
 * The document is generated from the same Zod schemas the routes validate
 * against, so it cannot drift from the implementation — a hand-written spec
 * always eventually lies.
 *
 * The explorer is disabled in production by default. It is not a security
 * boundary on its own (the endpoints exist either way), but publishing a
 * complete, executable map of an authenticated API to anonymous visitors is
 * free reconnaissance, and there is no reason to hand it over.
 */

export interface OpenApiOptions {
  readonly env: ApiEnvironment;
}

const openApiPlugin: FastifyPluginAsync<OpenApiOptions> = async (app, options) => {
  const { env } = options;

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'TrendHunter API',
        version: '1.0.0',
        description: [
          'Content intelligence and trend discovery.',
          '',
          'Every endpoint answers with one of two envelopes:',
          '`{ "data": ..., "meta": ... }` on success, and',
          '`{ "error": { "code": ..., "message": ... } }` on failure.',
          '',
          'Authentication is a session cookie issued by `/api/auth/*`.',
          'Those endpoints are served by Better Auth and are not described here.',
        ].join('\n'),
      },
      servers: [{ url: env.API_URL, description: env.NODE_ENV }],
      tags: [
        { name: 'health', description: 'Liveness and readiness probes.' },
        { name: 'dashboard', description: 'Aggregated read models for the dashboard.' },
        { name: 'posts', description: 'Collected posts and their comments.' },
        { name: 'topics', description: 'Detected topics and their trend history.' },
        { name: 'trends', description: 'Trending, emerging and hidden-gem topics.' },
        { name: 'search', description: 'Keyword, semantic and hybrid search.' },
        { name: 'sources', description: 'Provider configuration. Administrator only.' },
        { name: 'interests', description: "The user's interest profile." },
        { name: 'translations', description: 'Translation and Arabic localisation.' },
        { name: 'content', description: 'The Content Studio.' },
        { name: 'threads', description: 'X thread drafting and translation.' },
        { name: 'saved', description: 'Saved posts, topics, threads and drafts.' },
        { name: 'publications', description: 'Manually published content.' },
        { name: 'reports', description: 'Analytical reports.' },
        { name: 'operations', description: 'Scans, jobs and provider usage.' },
        { name: 'settings', description: 'User preferences.' },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'trendhunter.session_token',
            description: 'Session cookie issued by `POST /api/auth/sign-in/email`.',
          },
        },
      },
      security: [{ sessionCookie: [] }],
    },
    transform: jsonSchemaTransform,
    // Required for schemas registered in `z.globalRegistry` to become
    // `$ref`s in `components.schemas` rather than being inlined everywhere.
    transformObject: jsonSchemaTransformObject,
    hideUntagged: false,
  });

  if (!env.ENABLE_API_DOCS) return;

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      filter: true,
    },
    staticCSP: true,
  });

  app.log.info({ url: `${env.API_URL}/docs` }, 'OpenAPI explorer enabled');
};

export default fp(openApiPlugin, { name: 'openapi' });
