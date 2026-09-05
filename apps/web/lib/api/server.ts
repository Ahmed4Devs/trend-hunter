import type { ApiErrorBody, ApiMeta, ApiSuccessEnvelope } from '@trendhunter/types';
import { cookies } from 'next/headers';

import { serverApiUrl } from '../env';
import { ApiError, ApiUnreachableError } from './errors';

/**
 * The API client for Server Components and Server Actions.
 *
 * Server-only by construction: it reads `next/headers` to forward the caller's
 * session cookie, which is a build error in a Client Component. That is
 * deliberate — the browser must never be handed a client that speaks with
 * someone else's cookies attached.
 *
 * Nothing here is cached. Every page in this product shows live collection
 * state, and Next's default fetch caching would serve a dashboard from before
 * the last scan with no indication that it had.
 */

export interface ApiResult<TData> {
  readonly data: TData;
  readonly meta: ApiMeta;
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly signal?: AbortSignal;
}

function buildUrl(path: string, query: ApiRequestOptions['query']): string {
  const url = new URL(`/api/v1${path}`, serverApiUrl());
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<TData>> {
  const { method = 'GET', body, query, signal } = options;
  const cookieStore = await cookies();

  // The whole cookie header is forwarded, not just the session cookie: Better
  // Auth also issues a signed cookie-cache cookie, and sending one without the
  // other makes the API fall back to a database lookup on every request.
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookieHeader === '' ? {} : { cookie: cookieHeader }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
      cache: 'no-store',
    });
  } catch (cause) {
    throw new ApiUnreachableError(`The API did not answer ${method} ${path}.`, { cause });
  }

  if (response.status === 204) {
    return { data: undefined as TData, meta: {} };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ApiUnreachableError(`The API answered ${method} ${path} with a non-JSON body.`, {
      cause,
    });
  }

  if (!response.ok) {
    if (isErrorEnvelope(payload)) throw new ApiError(response.status, payload.error);
    throw new ApiUnreachableError(
      `The API answered ${method} ${path} with ${String(response.status)} and an unrecognised body.`,
    );
  }

  if (!isSuccessEnvelope<TData>(payload)) {
    throw new ApiUnreachableError(`The API answered ${method} ${path} outside the envelope.`);
  }

  return { data: payload.data, meta: payload.meta };
}

/** Convenience for the common case where only the payload matters. */
export async function apiData<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TData> {
  const result = await apiFetch<TData>(path, options);
  return result.data;
}

function isErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object'
  );
}

function isSuccessEnvelope<TData>(value: unknown): value is ApiSuccessEnvelope<TData> {
  return typeof value === 'object' && value !== null && 'data' in value;
}
