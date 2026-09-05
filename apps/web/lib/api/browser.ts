import type { ApiErrorBody, ApiMeta, ApiSuccessEnvelope } from '@trendhunter/types';

import { env } from '../env';
import { ApiError, ApiUnreachableError } from './errors';

/**
 * The API client for Client Components.
 *
 * Used for interactions the reader triggers — saving a post, starting a scan,
 * typing in global search — where a round trip through a Server Action would
 * add a render pass for no benefit. Reads that a page needs in order to render
 * go through the server client instead.
 *
 * `credentials: 'include'` is required, not incidental: the web app and the API
 * are different origins in development, and the session cookie is not attached
 * to a cross-origin request without it. The API's CORS configuration names this
 * origin explicitly for the same reason.
 */

export interface BrowserRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly signal?: AbortSignal;
}

export interface BrowserResult<TData> {
  readonly data: TData;
  readonly meta: ApiMeta;
}

export async function browserFetch<TData>(
  path: string,
  options: BrowserRequestOptions = {},
): Promise<BrowserResult<TData>> {
  const { method = 'GET', body, query, signal } = options;

  const url = new URL(`/api/v1${path}`, env.NEXT_PUBLIC_API_URL);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    throw new ApiUnreachableError('The API could not be reached.', { cause });
  }

  if (response.status === 204) return { data: undefined as TData, meta: {} };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ApiUnreachableError('The API answered with a body that is not JSON.', { cause });
  }

  if (!response.ok) {
    if (hasErrorBody(payload)) throw new ApiError(response.status, payload.error);
    throw new ApiUnreachableError(`The API answered ${String(response.status)}.`);
  }

  if (!hasData<TData>(payload)) {
    throw new ApiUnreachableError('The API answered outside the response envelope.');
  }

  return { data: payload.data, meta: payload.meta };
}

function hasErrorBody(value: unknown): value is { error: ApiErrorBody } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object'
  );
}

function hasData<TData>(value: unknown): value is ApiSuccessEnvelope<TData> {
  return typeof value === 'object' && value !== null && 'data' in value;
}
