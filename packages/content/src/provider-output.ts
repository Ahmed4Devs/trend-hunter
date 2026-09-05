import { LlmProviderError, characterCount, isAppError, sanitizeText } from '@trendhunter/shared';
import type {
  GenerateRequest,
  GeneratedPost,
  GeneratedThread,
  LlmProvider,
} from '@trendhunter/types';

import { MAX_TITLE_CHARACTERS } from './prompts';

/**
 * The boundary between the LLM and the rest of the Content Studio.
 *
 * `LlmProvider` is an interface, so the compiler believes whatever an adapter
 * claims to return. At runtime the value has come out of a model, over HTTP,
 * through someone else's SDK, so nothing here trusts the declared types: every
 * field is re-checked, every string is sanitised, and character counts are
 * recomputed rather than read back from the provider.
 */

/** Character used when text has to be cut to fit a budget. */
const ELLIPSIS = '…';

/**
 * How far into the budget a whitespace break has to fall before it is used.
 * Below this, cutting at the break would throw away too much of the text and a
 * mid-clause cut reads better than a half-empty post.
 */
const WORD_BREAK_MIN_SHARE = 0.6;

export interface ProviderReply {
  /** The raw `value` of the provider result, deliberately untyped. */
  readonly value: unknown;
  readonly providerName: string;
  readonly providerModel: string;
}

/**
 * Calls the provider and normalises its identity.
 *
 * Adapters are contractually required to wrap their own failures in an
 * `AppError`; anything else that escapes is a defect in the adapter, and is
 * reported as an upstream failure rather than propagating a raw vendor error
 * (which may carry a URL, a key fragment or a stack) towards a client.
 */
export async function callProvider(
  provider: LlmProvider,
  request: GenerateRequest,
): Promise<ProviderReply> {
  const providerName = readString(provider.name) ?? 'unknown';
  const providerModel = readString(provider.model) ?? 'unknown';
  try {
    const result: unknown = await provider.generate(request);
    const meta = isRecord(result) ? result.meta : undefined;
    const metaRecord = isRecord(meta) ? meta : undefined;
    return {
      value: isRecord(result) ? result.value : undefined,
      providerName: readString(metaRecord?.provider) ?? providerName,
      providerModel: readString(metaRecord?.model) ?? providerModel,
    };
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new LlmProviderError(providerName, 'The content provider failed to generate a draft.', {
      cause: error,
      details: { provider: providerName, kind: request.kind },
    });
  }
}

/**
 * Validates a single generated post. The provider's own `characterCount` is
 * ignored: it is the number the UI enforces a limit against, so it is computed
 * here from the sanitised text.
 */
export function parseGeneratedPost(value: unknown, providerName: string): GeneratedPost {
  if (!isRecord(value)) {
    throw new LlmProviderError(providerName, 'The provider returned a malformed post.');
  }
  if (Array.isArray(value.posts)) {
    throw new LlmProviderError(
      providerName,
      'The provider returned a thread where a single post was requested.',
    );
  }
  const content = sanitizeText(readString(value.content) ?? '');
  if (content.length === 0) {
    throw new LlmProviderError(providerName, 'The provider returned an empty post.');
  }
  return {
    title: readTitle(value.title),
    content,
    characterCount: characterCount(content),
  };
}

/**
 * Validates a generated thread.
 *
 * Blank posts are dropped rather than rejected — a model occasionally emits a
 * trailing empty element, and losing the whole thread over it would be a worse
 * outcome than publishing one post fewer — but the surviving count still has to
 * meet `minPosts`.
 */
export function parseGeneratedThread(
  value: unknown,
  providerName: string,
  minPosts: number,
): GeneratedThread {
  if (!isRecord(value) || !Array.isArray(value.posts)) {
    throw new LlmProviderError(providerName, 'The provider returned a malformed thread.');
  }
  const posts: GeneratedPost[] = [];
  for (const entry of value.posts) {
    const content = sanitizeText(readPostContent(entry));
    if (content.length === 0) continue;
    posts.push({ title: null, content, characterCount: characterCount(content) });
  }
  if (posts.length < minPosts) {
    throw new LlmProviderError(
      providerName,
      `The provider returned ${posts.length} usable thread posts; at least ${minPosts} are required.`,
      { details: { returned: posts.length, required: minPosts } },
    );
  }
  return { title: readTitle(value.title) ?? '', posts };
}

export interface FittedText {
  readonly text: string;
  /** True when the text overran its budget and had to be cut. */
  readonly trimmed: boolean;
}

/**
 * Cuts text down to a character budget, counted the way X counts it.
 *
 * `truncate` from `@trendhunter/shared` is deliberately not used here: it works
 * in UTF-16 units, so it can both over-cut emoji-heavy text and split a
 * surrogate pair. Thread splitting and post limits are exactly where that
 * matters, so this cuts on code points and only ever breaks between words.
 */
export function fitToBudget(text: string, budget: number): FittedText {
  const clean = sanitizeText(text);
  if (budget <= 0) return { text: '', trimmed: clean.length > 0 };
  if (characterCount(clean) <= budget) return { text: clean, trimmed: false };

  const room = Math.max(1, budget - 1);
  const head = Array.from(clean).slice(0, room).join('');
  const breakIndex = lastWhitespaceIndex(head);
  const body = breakIndex > room * WORD_BREAK_MIN_SHARE ? head.slice(0, breakIndex) : head;
  return { text: `${body.trimEnd()}${ELLIPSIS}`, trimmed: true };
}

/** Index of the last whitespace character, or -1. */
export function lastWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index];
    if (character !== undefined && /\s/u.test(character)) return index;
  }
  return -1;
}

function readPostContent(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (isRecord(entry)) return readString(entry.content) ?? '';
  return '';
}

function readTitle(value: unknown): string | null {
  const title = readString(value);
  if (title === undefined) return null;
  const clean = sanitizeText(title).replace(/\s+/g, ' ').trim();
  if (clean.length === 0) return null;
  return fitToBudget(clean, MAX_TITLE_CHARACTERS).text;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
