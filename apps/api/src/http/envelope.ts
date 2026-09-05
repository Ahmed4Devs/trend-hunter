import { API_ERROR_CODES, type ApiErrorCode, type PaginationMeta } from '@trendhunter/types';
import { z } from 'zod';

/**
 * The response envelope.
 *
 * Every endpoint answers with exactly one of two shapes, so a client never has
 * to guess where the payload is:
 *
 *     { "data": ..., "meta": { ... } }
 *     { "error": { "code": ..., "message": ..., "details": { ... } } }
 *
 * The schemas are declared here and composed by each route, which is what makes
 * the generated OpenAPI document describe the envelope rather than the bare
 * payload.
 */

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export const apiMetaSchema = z
  .object({
    requestId: z.string().optional(),
    pagination: paginationMetaSchema.optional(),
  })
  .loose();

/** Wraps a payload schema in the success envelope. */
export function successEnvelope<TSchema extends z.ZodType>(data: TSchema) {
  return z.object({ data, meta: apiMetaSchema });
}

/**
 * Wraps an item schema in the paginated success envelope.
 *
 * The array is declared readonly because every domain collection is readonly;
 * without it a handler would have to copy each page into a mutable array purely
 * to satisfy the serializer's inferred type.
 */
export function paginatedEnvelope<TSchema extends z.ZodType>(item: TSchema) {
  return z.object({
    data: z.array(item).readonly(),
    meta: apiMetaSchema.extend({ pagination: paginationMetaSchema }),
  });
}

/** A readonly array, for `successEnvelope` payloads that are collections. */
export function readonlyArray<TSchema extends z.ZodType>(item: TSchema) {
  return z.array(item).readonly();
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    // Free-form but always non-sensitive: field paths and validation messages,
    // never the offending value and never anything from an exception's cause.
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * The error responses every route declares.
 *
 * Declared once so the OpenAPI document is honest about what can come back:
 * an endpoint that documents only its happy path is a document a client cannot
 * write error handling against.
 */
export const commonErrorResponses = {
  400: errorEnvelopeSchema.describe('The request failed validation.'),
  401: errorEnvelopeSchema.describe('Authentication is required.'),
  403: errorEnvelopeSchema.describe('The caller may not perform this operation.'),
  429: errorEnvelopeSchema.describe('Too many requests.'),
  500: errorEnvelopeSchema.describe('An unexpected error occurred.'),
} as const;

export const notFoundResponse = {
  404: errorEnvelopeSchema.describe('The resource does not exist.'),
} as const;

export function ok<TData>(data: TData, meta: Record<string, unknown> = {}) {
  return { data, meta };
}

export function paginated<TItem>(
  items: readonly TItem[],
  pagination: PaginationMeta,
  meta: Record<string, unknown> = {},
) {
  return { data: items, meta: { ...meta, pagination } };
}

export function errorBody(
  code: ApiErrorCode,
  message: string,
  extras: { details?: Record<string, unknown>; requestId?: string } = {},
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(extras.details === undefined ? {} : { details: extras.details }),
      ...(extras.requestId === undefined ? {} : { requestId: extras.requestId }),
    },
  };
}
