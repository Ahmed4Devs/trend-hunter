/**
 * REST transport contracts.
 *
 * Every `/api/v1` endpoint answers with exactly one of these two envelopes.
 * They are declared here (rather than in the API app) because the web client
 * and the E2E tests type against the same shapes.
 */

import type { ContentLanguage, SearchEntityKind, SearchMode } from './enums';
import type { Comment, Post, Topic } from './domain';

/** Machine-readable error codes. The HTTP status is derived from these. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPSTREAM_UNAVAILABLE',
  'FEATURE_DISABLED',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Metadata attached to a successful response. */
export interface ApiMeta {
  readonly requestId?: string;
  readonly pagination?: PaginationMeta;
  readonly [key: string]: unknown;
}

export interface ApiSuccessEnvelope<TData> {
  readonly data: TData;
  readonly meta: ApiMeta;
}

export interface ApiErrorBody {
  readonly code: ApiErrorCode;
  /**
   * Operator-safe message. Never contains stack traces, SQL, file system paths,
   * connection strings or provider credentials.
   */
  readonly message: string;
  /** Structured, non-sensitive context such as failing field paths. */
  readonly details?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
}

export interface ApiErrorEnvelope {
  readonly error: ApiErrorBody;
}

export type ApiResponse<TData> = ApiSuccessEnvelope<TData> | ApiErrorEnvelope;

export function isApiError<TData>(value: ApiResponse<TData>): value is ApiErrorEnvelope {
  return 'error' in value;
}

/** Offset pagination is used everywhere; cursors are not needed at this scale. */
export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

export interface Paginated<TItem> {
  readonly items: readonly TItem[];
  readonly pagination: PaginationMeta;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Deepest page any list endpoint will serve.
 *
 * Offset pagination degrades with depth — PostgreSQL still walks every skipped
 * row — and the vector arm of search derives `hnsw.ef_search` from the offset,
 * where pgvector's own ceiling of 1000 turns a deep page into a failed query
 * rather than a slow one. Nothing in this product pages past a few hundred
 * results by hand, so the depth is capped rather than left for a scripted
 * caller to discover.
 */
export const MAX_PAGE = 500;

export type SortDirection = 'asc' | 'desc';

export interface SortParams<TField extends string = string> {
  readonly sortBy: TField;
  readonly sortDirection: SortDirection;
}

/**
 * A ranked search hit.
 *
 * The resolved object is carried inline and typed as nullable per entity, so a
 * client renders `result.topic` or `result.post` by looking at `entity` rather
 * than by probing which field happens to be present.
 */
export interface SearchResult {
  readonly id: string;
  readonly entity: SearchEntityKind;
  /** 0..1 fused score, comparable only within one result set. */
  readonly score: number;
  readonly keywordRank: number | null;
  readonly semanticRank: number | null;
  /** The matched fragment with the query terms marked, when the engine produced one. */
  readonly headline: string | null;
  readonly post: Post | null;
  readonly topic: Topic | null;
  readonly comment: Comment | null;
}

export interface SearchResponse {
  readonly query: string;
  readonly mode: SearchMode;
  readonly language: ContentLanguage;
  /**
   * True when the vector arm was skipped because no query embedding could be
   * produced, so the results are keyword-only. Reported rather than swallowed:
   * a reader who searched for a paraphrase and got nothing needs to know why.
   */
  readonly degradedToKeyword: boolean;
  readonly results: readonly SearchResult[];
}

export interface SearchSuggestion {
  readonly value: string;
  readonly kind: 'topic' | 'author';
}
