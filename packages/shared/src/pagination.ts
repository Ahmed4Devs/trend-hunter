import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  type PaginationMeta,
  type PaginationParams,
} from '@trendhunter/types';

/**
 * Offset pagination helpers.
 *
 * Every list endpoint is bounded in both directions: an unpaginated query
 * against `Post` would happily try to serialise the whole table, and an
 * unbounded `page` would ask PostgreSQL to walk millions of rows only to
 * discard them. Both are clamped here rather than trusted from the request —
 * the request schemas reject an out-of-range value outright, and this is the
 * backstop for the callers that reach a repository without passing through one.
 */

export function normalizePaginationParams(
  input: Partial<PaginationParams> | undefined,
): PaginationParams {
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(input?.page ?? 1)));
  const requested = Math.floor(input?.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  return { page, pageSize };
}

export function toSkipTake(params: PaginationParams): { skip: number; take: number } {
  return { skip: (params.page - 1) * params.pageSize, take: params.pageSize };
}

export function buildPaginationMeta(params: PaginationParams, totalItems: number): PaginationMeta {
  const safeTotal = Math.max(0, Math.floor(totalItems));
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / params.pageSize);
  return {
    page: params.page,
    pageSize: params.pageSize,
    totalItems: safeTotal,
    totalPages,
    hasNextPage: params.page < totalPages,
    hasPreviousPage: params.page > 1 && totalPages > 0,
  };
}
