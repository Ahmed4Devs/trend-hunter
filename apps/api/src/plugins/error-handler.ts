import { AppError, toAppError } from '@trendhunter/shared';
import type { ApiErrorCode } from '@trendhunter/types';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import fp from 'fastify-plugin';

import { errorBody } from '../http/envelope';

/**
 * The error boundary.
 *
 * Fastify's default handler serialises `error.message` verbatim for every
 * status *including 500*, and does not distinguish development from production.
 * Left alone, an unhandled Prisma failure would send the failing SQL, the model
 * names and sometimes the offending values straight to the client. This handler
 * is what stops that.
 *
 * The rule it enforces: a 4xx explains itself, a 5xx says nothing. Everything
 * needed to diagnose a 5xx is logged server-side with the request id, and the
 * client gets that id so a user can quote it in a bug report.
 */

/** Maps a status the framework produced onto our error vocabulary. */
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'FEATURE_DISABLED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}

const errorHandlerPlugin: FastifyPluginAsync = (app) => {
  app.setErrorHandler(function handleError(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const requestId = request.id;

    // 1. Request validation. The only 4xx that carries structured detail, and
    //    it is safe to: the paths and messages come from our own schemas.
    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.info({ validation: error.validation }, 'request validation failed');
      const details: Record<string, string[]> = {};
      for (const issue of error.validation) {
        const path = issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || '_';
        (details[path] ??= []).push(issue.message ?? 'is invalid');
      }
      return reply
        .code(400)
        .send(
          errorBody('VALIDATION_ERROR', 'The request payload is invalid.', { details, requestId }),
        );
    }

    // 2. Response serialisation. This is always a bug in this codebase — the
    //    handler returned something its own schema rejects — so it is a 500 and
    //    the issues stay in the log.
    if (typeof error === 'object' && isResponseSerializationError(error)) {
      request.log.error(
        { issues: error.cause.issues, method: error.method, url: error.url },
        'response serialization failed',
      );
      return reply
        .code(500)
        .send(errorBody('INTERNAL_ERROR', 'An unexpected error occurred.', { requestId }));
    }

    // 3. Errors this application raised deliberately.
    if (error instanceof AppError) {
      const payload = error.toClientPayload(requestId);
      const log = error.statusCode >= 500 ? request.log.error : request.log.info;
      log.call(request.log, { err: error, code: error.code }, 'request failed');
      return reply.code(error.statusCode).send({ error: payload });
    }

    // 4. Errors the framework or a plugin raised — rate limiting, unsupported
    //    media type, a malformed JSON body. Their messages are framework text,
    //    not user data, so they are safe to pass through.
    const status = error.statusCode ?? 500;
    if (status < 500) {
      request.log.info({ err: error }, 'client error');
      return reply
        .code(status)
        .send(errorBody(codeForStatus(status), error.message, { requestId }));
    }

    // 5. Anything else. The full error, stack included, goes to the log; the
    //    client is told only that something went wrong.
    const wrapped = toAppError(error);
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send(errorBody(wrapped.code, 'An unexpected error occurred.', { requestId }));
  });

  /** A 404 that speaks the same envelope as everything else. */
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(
        errorBody('NOT_FOUND', 'The requested endpoint does not exist.', { requestId: request.id }),
      );
  });

  return Promise.resolve();
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
