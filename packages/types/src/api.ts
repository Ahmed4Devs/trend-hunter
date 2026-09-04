/**
 * REST transport contracts.
 *
 * Every `/api/v1` endpoint answers with exactly one of these two envelopes.
 * They are declared here (rather than in the API app) because the web client
 * and the E2E tests type against the same shapes.
 */

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

export type SortDirection = 'asc' | 'desc';

export interface SortParams<TField extends string = string> {
  readonly sortBy: TField;
  readonly sortDirection: SortDirection;
}
