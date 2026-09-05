import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ApiMeta,
  type PaginationMeta,
} from '@trendhunter/types';

/**
 * Reading list state out of the query string.
 *
 * Every list page keeps its filters, sort and page in the URL, so a view is
 * reproducible: the back button works, a filtered list can be sent to someone,
 * and a refresh does not silently reset to page one.
 *
 * Everything here treats the query string as untrusted input, because it is —
 * these values go on to become API parameters.
 */

export type SearchParamRecord = Record<string, string | string[] | undefined>;

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A page number, clamped to something a person could plausibly have asked for. */
export function pageParam(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(first(value) ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 10_000) : 1;
}

export function pageSizeParam(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(first(value) ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

/** A value constrained to a known set; anything else falls back. */
export function enumParam<TValue extends string>(
  value: string | string[] | undefined,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  const candidate = first(value);
  return allowed.includes(candidate as TValue) ? (candidate as TValue) : fallback;
}

/** The same, but optional: absent stays absent rather than becoming a default. */
export function optionalEnumParam<TValue extends string>(
  value: string | string[] | undefined,
  allowed: readonly TValue[],
): TValue | undefined {
  const candidate = first(value);
  return allowed.includes(candidate as TValue) ? (candidate as TValue) : undefined;
}

/**
 * A comma-separated multi-select, filtered to the values that exist.
 *
 * Returns `undefined` rather than an empty array when nothing survives, because
 * "no filter" and "a filter that matches nothing" are different requests.
 */
export function csvEnumParam<TValue extends string>(
  value: string | string[] | undefined,
  allowed: readonly TValue[],
): readonly TValue[] | undefined {
  const candidate = first(value);
  if (candidate === undefined || candidate === '') return undefined;
  const values = candidate
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is TValue => allowed.includes(part as TValue));
  return values.length === 0 ? undefined : values;
}

/** A free-text term, length-bounded so a pathological query string cannot be forwarded. */
export function textParam(
  value: string | string[] | undefined,
  maxLength = 200,
): string | undefined {
  const candidate = first(value)?.trim();
  if (candidate === undefined || candidate === '') return undefined;
  return candidate.slice(0, maxLength);
}

/** Serialises a filter set back into a query string, dropping empty values. */
export function toQueryString(
  params: Readonly<Record<string, string | number | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

/**
 * The pagination block of a paginated response.
 *
 * Every paginated endpoint sends one, but `ApiMeta` types it as optional
 * because the same envelope carries unpaginated responses. The fallback lives
 * here so a list page never has to decide what an absent block means.
 */
export function paginationOf(meta: ApiMeta, page: number): PaginationMeta {
  return (
    meta.pagination ?? {
      page,
      pageSize: 0,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: page > 1,
    }
  );
}
