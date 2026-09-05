import { setTimeout as sleep } from 'node:timers/promises';

import { assertSafeUrl, UpstreamError, ValidationError } from '@trendhunter/shared';
import type { ZodType } from 'zod';

/**
 * The outbound HTTP boundary for every live adapter.
 *
 * Nothing in this package calls `fetch` directly. Everything a request to an
 * untrusted host has to get right is concentrated here:
 *
 *  - the SSRF guard runs before *every* request, including each redirect hop,
 *    because a permitted host is free to redirect to `169.254.169.254`;
 *  - the response body is read through a byte budget rather than
 *    `response.text()`, so a hostile or misconfigured host cannot exhaust
 *    memory by streaming forever;
 *  - retries are bounded, back off exponentially and honour `Retry-After`,
 *    because hammering a provider that just rate-limited us is how an API key
 *    gets suspended;
 *  - errors quote only the origin and path of a URL. Provider credentials
 *    travel in headers and query strings, and an error message ends up in logs,
 *    scan records and occasionally in front of a user.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  /** Sent on every request; providers block unidentified clients. */
  readonly userAgent: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
  /** Total attempts per hop, including the first. */
  readonly maxAttempts?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  /** Development-only escape hatch; the environment schema forbids it in production. */
  readonly allowPrivateNetworks?: boolean;
  /** Injected for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Injected for tests, so a backoff does not make the suite slow. */
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface HttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly accept?: string;
  readonly signal?: AbortSignal;
  /** Called once per network attempt, retries included, for usage accounting. */
  readonly onAttempt?: () => void;
  /** Names the provider in error messages, e.g. `github`. */
  readonly provider: string;
}

export interface HttpTextResponse {
  /** The final URL after any redirects. */
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxResponseBytes: 4 * 1024 * 1024,
  maxRedirects: 3,
  maxAttempts: 3,
  baseRetryDelayMs: 500,
  maxRetryDelayMs: 20_000,
} as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class HttpClient {
  readonly #options: Required<Omit<HttpClientOptions, 'fetchImpl' | 'sleepImpl'>>;
  readonly #fetch: FetchLike;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: HttpClientOptions) {
    this.#options = {
      userAgent: options.userAgent,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxResponseBytes: options.maxResponseBytes ?? DEFAULTS.maxResponseBytes,
      maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
      maxAttempts: Math.max(1, options.maxAttempts ?? DEFAULTS.maxAttempts),
      baseRetryDelayMs: options.baseRetryDelayMs ?? DEFAULTS.baseRetryDelayMs,
      maxRetryDelayMs: options.maxRetryDelayMs ?? DEFAULTS.maxRetryDelayMs,
      allowPrivateNetworks: options.allowPrivateNetworks ?? false,
    };
    this.#fetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.#sleep =
      options.sleepImpl ??
      (async (ms, signal): Promise<void> => {
        await sleep(ms, undefined, { signal });
      });
  }

  /**
   * Performs a request, following redirects and retrying transient failures.
   * Every hop is re-validated by the SSRF guard before it is issued.
   */
  async requestText(request: HttpRequest): Promise<HttpTextResponse> {
    let target = request.url;
    let method = request.method ?? 'GET';
    let body = request.body;

    for (let hop = 0; hop <= this.#options.maxRedirects; hop += 1) {
      request.signal?.throwIfAborted();

      const { url } = await assertSafeUrl(target, {
        allowPrivateNetworks: this.#options.allowPrivateNetworks,
      });
      const response = await this.#attempt(url, { ...request, method, body });

      if (!REDIRECT_STATUSES.has(response.status)) {
        return {
          url: describeUrl(url),
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: await readBoundedText(
            response,
            this.#options.maxResponseBytes,
            request.provider,
            url,
          ),
        };
      }

      const location = response.headers.get('location');
      await discard(response);
      if (location === null || location.trim() === '') {
        throw new UpstreamError(
          request.provider,
          `${describeUrl(url)} answered ${String(response.status)} without a Location header.`,
        );
      }

      // 303 — and, in practice, 301/302 after a POST — continue as a GET.
      if (response.status === 303 || (method === 'POST' && response.status !== 307)) {
        method = 'GET';
        body = undefined;
      }
      target = resolveLocation(location, url, request.provider);
    }

    throw new UpstreamError(
      request.provider,
      `Request to ${describeUrl(new URL(request.url))} exceeded ${String(this.#options.maxRedirects)} redirects.`,
    );
  }

  /** Fetches JSON and validates it. Untrusted payloads never reach a caller unparsed. */
  async requestJson<T>(request: HttpRequest, schema: ZodType<T>): Promise<T> {
    const response = await this.requestText({
      accept: 'application/json',
      ...request,
    });

    if (response.status >= 400) {
      throw new UpstreamError(
        request.provider,
        `${response.url} answered ${String(response.status)}.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new UpstreamError(request.provider, `${response.url} did not answer with valid JSON.`);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new UpstreamError(
        request.provider,
        `${response.url} answered with an unexpected shape: ${summarizeIssues(result.error.issues)}`,
      );
    }
    return result.data;
  }

  /** One hop, with bounded retries on rate limiting and server errors. */
  async #attempt(url: URL, request: HttpRequest): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      request.signal?.throwIfAborted();
      request.onAttempt?.();

      let response: Response | undefined;
      try {
        response = await this.#fetch(url.toString(), this.#buildInit(request));
      } catch (error) {
        lastError = error;
        if (isAbort(error, request.signal)) throw error;
        if (attempt >= this.#options.maxAttempts) break;
        await this.#backoff(attempt, null, request.signal);
        continue;
      }

      if (!isRetryable(response.status) || attempt >= this.#options.maxAttempts) {
        return response;
      }

      const retryAfter = response.headers.get('retry-after');
      await discard(response);
      await this.#backoff(attempt, retryAfter, request.signal);
    }

    throw new UpstreamError(
      request.provider,
      `Request to ${describeUrl(url)} failed after ${String(this.#options.maxAttempts)} attempts.`,
      { cause: lastError },
    );
  }

  #buildInit(request: HttpRequest): RequestInit {
    const headers: Record<string, string> = {
      'user-agent': this.#options.userAgent,
      accept: request.accept ?? '*/*',
      'accept-encoding': 'gzip, deflate',
      ...lowercaseKeys(request.headers),
    };

    const signals = [AbortSignal.timeout(this.#options.timeoutMs)];
    if (request.signal) signals.push(request.signal);

    return {
      method: request.method ?? 'GET',
      headers,
      // Redirects are followed by hand so that each hop passes the SSRF guard.
      redirect: 'manual',
      signal: AbortSignal.any(signals),
      ...(request.body === undefined ? {} : { body: request.body }),
    };
  }

  async #backoff(attempt: number, retryAfter: string | null, signal?: AbortSignal): Promise<void> {
    const exponential = this.#options.baseRetryDelayMs * 2 ** (attempt - 1);
    const requested = parseRetryAfter(retryAfter);
    const delayMs = Math.min(
      this.#options.maxRetryDelayMs,
      Math.max(exponential, requested ?? 0),
    );
    await this.#sleep(delayMs, signal);
  }
}

/** 429 and 5xx are worth another attempt; 408 is a server-side read timeout. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Reads a response body under a byte budget.
 *
 * `response.text()` would buffer whatever the peer sends, so the stream is read
 * chunk by chunk and abandoned the moment the budget is exceeded.
 */
async function readBoundedText(
  response: Response,
  maxBytes: number,
  provider: string,
  url: URL,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    throw new UpstreamError(
      provider,
      `${describeUrl(url)} declared a ${String(declared)} byte body, above the ${String(maxBytes)} byte limit.`,
    );
  }

  const stream = response.body;
  if (!stream) return '';

  // Typed explicitly: the DOM lib declares `body` loosely enough that the
  // chunk would otherwise arrive as `any` and defeat the size accounting below.
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new UpstreamError(
          provider,
          `${describeUrl(url)} returned more than the ${String(maxBytes)} byte response limit.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return decodeBody(merged, response.headers.get('content-type'));
}

/**
 * Decodes with the declared charset when there is one.
 *
 * Feeds in particular are still published as ISO-8859-1 and Windows-1252, and
 * decoding those as UTF-8 turns every accented character into a replacement
 * character that then poisons the content hash.
 */
function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = charsetFromContentType(contentType);
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown label: fall through to UTF-8 rather than failing the collection.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

const CHARSET_PATTERN = /charset\s*=\s*"?([\w-]+)"?/i;

function charsetFromContentType(contentType: string | null): string | undefined {
  if (contentType === null) return undefined;
  return CHARSET_PATTERN.exec(contentType)?.[1];
}

/** Parses `Retry-After` in both its forms: delay-seconds and an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds <= 0 ? 0 : seconds * 1000;

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

/**
 * Resolves a `Location` header against the URL that produced it.
 *
 * The result is only shape-checked here; the caller re-runs the full guard,
 * DNS resolution included, before the next request is issued.
 */
function resolveLocation(location: string, base: URL, provider: string): string {
  try {
    return new URL(location, base).toString();
  } catch {
    throw new UpstreamError(provider, `${describeUrl(base)} redirected to an unparseable location.`);
  }
}

/**
 * The safe rendering of a URL: origin and path only.
 *
 * Query strings routinely carry API keys, and the URL object may carry
 * credentials in its userinfo. Neither belongs in an error message.
 */
export function describeUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function lowercaseKeys(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = value;
  return result;
}

/** Releases a response body that will not be read, so the socket is not held. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Distinguishes the caller cancelling from a request timing out. */
function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && error instanceof Error && error.name === 'AbortError';
}

function summarizeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

/**
 * Asserts a URL is safe to fetch without issuing the request.
 *
 * Used when configuration is validated, so a bad feed URL is reported when it
 * is saved rather than during a scan.
 */
export async function assertFetchable(
  rawUrl: string,
  allowPrivateNetworks: boolean,
): Promise<URL> {
  const { url } = await assertSafeUrl(rawUrl, { allowPrivateNetworks });
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs can be collected from.');
  }
  return url;
}
