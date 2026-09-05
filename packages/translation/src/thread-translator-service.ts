import {
  characterCount,
  detectLanguage,
  MAX_THREAD_LENGTH,
  sanitizeText,
  THREAD_COUNTER_RESERVED_CHARACTERS,
  truncate,
  ValidationError,
  X_POST_CHARACTER_LIMIT,
} from '@trendhunter/shared';
import type {
  ContentLanguage,
  LlmProvider,
  TerminologyPreference,
  TranslationMode,
} from '@trendhunter/types';

import { splitSentences } from './arabic-optimizer-service';
import { SameLanguageError } from './translation-service';
import type { TranslationService } from './translation-service';

/**
 * Whole-thread translation.
 *
 * **A thread is translated as one narrative, never post by post.** Translating
 * each post on its own is the obvious implementation and it is wrong, for
 * reasons that only show up in the finished thread:
 *
 *  - *Cross-references break.* Post 4 says "this" and means the benchmark from
 *    post 2. A model translating post 4 alone cannot see the benchmark, so it
 *    picks a gender and a referent at random — and Arabic, unlike English,
 *    marks both on the pronoun, so the mistake is visible in every sentence.
 *  - *The hook stops being a hook.* Post 1 is written to make someone stop
 *    scrolling. Translated in isolation it becomes a neutral topic sentence,
 *    because nothing in that one post tells the model it is opening anything.
 *  - *The conclusion stops landing.* The last post pays off a promise made in
 *    the first. Out of context it reads as one more observation.
 *  - *Terminology and register drift.* Independent calls choose independent
 *    renderings, so the same term appears three ways in seven posts.
 *
 * So the thread is summarised first, joined into one text, translated once,
 * optimised once, and only then cut back into posts on sentence boundaries.
 * The sequence is preserved by construction: the partition is contiguous, so
 * the first sentence of the source can only land in the first post and the last
 * in the last.
 */

export interface ThreadTranslationRequest {
  /** The thread in order, one entry per post. */
  readonly posts: readonly string[];
  readonly targetLanguage: ContentLanguage;
  readonly sourceLanguage?: ContentLanguage;
  readonly mode?: TranslationMode;
  readonly terminologyPreference?: TerminologyPreference;
  /** Thread title, when it has one; used only to steer the context summary. */
  readonly title?: string;
  /** Defaults to the X post limit. */
  readonly characterLimit?: number;
}

export interface TranslatedThreadPost {
  /** 1-based position, matching `ThreadPost.position`. */
  readonly position: number;
  readonly content: string;
  /** Counted the way X counts, and excluding the `n/N` counter. */
  readonly characterCount: number;
}

export interface ThreadTranslationResult {
  readonly posts: readonly TranslatedThreadPost[];
  readonly contextSummary: string;
  readonly sourceLanguage: ContentLanguage;
  readonly targetLanguage: ContentLanguage;
  readonly mode: TranslationMode;
  readonly preservedTerms: readonly string[];
  readonly requestedPostCount: number;
  /** True when the thread could not come back at its original length. */
  readonly postCountChanged: boolean;
  readonly explanation: string;
  readonly providerName: string;
  /** Characters available to each post once the counter is reserved. */
  readonly postCharacterBudget: number;
}

/** Sentences the context summary may run to. Enough to carry the arc. */
const CONTEXT_SUMMARY_SENTENCES = 3;

const MAX_CONTEXT_SUMMARY_CHARACTERS = 600;

export interface ThreadTranslatorDependencies {
  readonly provider: LlmProvider;
  readonly translationService: TranslationService;
}

export class ThreadTranslatorService {
  private readonly provider: LlmProvider;
  private readonly translationService: TranslationService;

  constructor(dependencies: ThreadTranslatorDependencies) {
    this.provider = dependencies.provider;
    this.translationService = dependencies.translationService;
  }

  async translateThread(request: ThreadTranslationRequest): Promise<ThreadTranslationResult> {
    const posts = request.posts.map((post) => sanitizeText(post)).filter((post) => post.length > 0);
    if (posts.length === 0) {
      throw new ValidationError('A thread must contain at least one post.');
    }
    if (posts.length > MAX_THREAD_LENGTH) {
      throw new ValidationError(`A thread may not exceed ${MAX_THREAD_LENGTH} posts.`);
    }
    if (request.targetLanguage === 'OTHER') {
      throw new ValidationError('A translation target must be Arabic or English.');
    }

    const characterLimit = request.characterLimit ?? X_POST_CHARACTER_LIMIT;
    const budget = characterLimit - THREAD_COUNTER_RESERVED_CHARACTERS;
    if (budget < 1) {
      throw new ValidationError(
        `A character limit of ${characterLimit} leaves no room for the thread counter.`,
      );
    }

    // Joined with a blank line: the original post boundaries are the author's
    // own paragraph breaks, which makes them the best available hints for where
    // to cut afterwards, and a sentence boundary the splitter can rely on.
    const narrative = posts.join('\n\n');
    const sourceLanguage = request.sourceLanguage ?? detectLanguage(narrative).language;
    if (sourceLanguage === request.targetLanguage) {
      throw new SameLanguageError(sourceLanguage);
    }

    const contextSummary = await this.buildContextSummary(posts, sourceLanguage, request.title);

    const translated = await this.translationService.translate({
      text: narrative,
      targetLanguage: request.targetLanguage,
      sourceLanguage,
      mode: request.mode,
      terminologyPreference: request.terminologyPreference,
      contextSummary,
    });

    const sentences = splitSentences(translated.translatedText);
    const grouped = partitionSentences(sentences, posts.length, budget);
    const contents = grouped.flatMap((group) => enforceBudget(group, budget));

    const threadPosts: TranslatedThreadPost[] = contents.map((content, index) => ({
      position: index + 1,
      content,
      characterCount: characterCount(content),
    }));

    return {
      posts: threadPosts,
      contextSummary,
      sourceLanguage,
      targetLanguage: request.targetLanguage,
      mode: translated.mode,
      preservedTerms: translated.preservedTerms,
      requestedPostCount: posts.length,
      postCountChanged: threadPosts.length !== posts.length,
      explanation: buildThreadExplanation({
        requested: posts.length,
        produced: threadPosts.length,
        budget,
        translationExplanation: translated.explanation,
      }),
      providerName: translated.providerName,
      postCharacterBudget: budget,
    };
  }

  /**
   * A three-sentence précis of the entire thread, handed to the translation
   * call as context.
   *
   * The provider does this when it can, because a model reads the arc better
   * than a heuristic does. When it cannot — an outage, or a payload that fails
   * validation — the deterministic fallback is used rather than failing the
   * translation: a slightly weaker context is a far better outcome than no
   * translated thread.
   */
  private async buildContextSummary(
    posts: readonly string[],
    language: ContentLanguage,
    title: string | undefined,
  ): Promise<string> {
    const body = title === undefined ? posts.join('\n\n') : `${title}\n\n${posts.join('\n\n')}`;
    try {
      const response = await this.provider.summarize({
        text: body,
        language,
        maxSentences: CONTEXT_SUMMARY_SENTENCES,
      });
      const summary: unknown = response.value;
      if (typeof summary === 'string' && summary.trim().length > 0) {
        return truncate(summary.trim(), MAX_CONTEXT_SUMMARY_CHARACTERS);
      }
    } catch {
      // Falls through to the deterministic summary below.
    }
    return fallbackContextSummary(posts, title);
  }
}

/**
 * The context every thread translation gets even when the provider cannot
 * summarise: the opening, the closing, and the length. Those three facts are
 * what stop the model from flattening the hook and the payoff.
 */
export function fallbackContextSummary(posts: readonly string[], title?: string): string {
  const first = posts[0] ?? '';
  const last = posts.at(-1) ?? '';
  const opening = splitSentences(first)[0] ?? first;
  const closing = splitSentences(last).at(-1) ?? last;

  const parts = [
    title === undefined ? null : `Thread title: ${title}.`,
    `A thread of ${String(posts.length)} posts.`,
    `It opens with: ${opening}`,
    posts.length > 1 ? `It closes with: ${closing}` : null,
    'Translate it as one continuous piece: the opening must still work as a hook and the closing must still work as a conclusion.',
  ].filter((part): part is string => part !== null);

  return truncate(parts.join(' '), MAX_CONTEXT_SUMMARY_CHARACTERS);
}

/**
 * Splits sentences into `groupCount` contiguous groups of roughly equal length.
 *
 * Contiguity is the whole point: it is what preserves the sequence of the
 * thread and pins the hook to the first post and the conclusion to the last.
 * Balance is only an aesthetic — a thread whose third post is four words long
 * looks broken — so it yields whenever it would leave a group empty.
 *
 * Returns fewer groups than asked for when there are not enough sentences to go
 * round. Splitting a sentence to make up the numbers is not an option: a post
 * that starts mid-thought is worse than a thread one post shorter.
 */
export function partitionSentences(
  sentences: readonly string[],
  groupCount: number,
  budget: number,
): string[][] {
  if (sentences.length === 0) return [];

  const totalCharacters = sentences.reduce(
    (total, sentence) => total + characterCount(sentence),
    0,
  );
  // When the translation genuinely cannot fit in the requested number of posts,
  // plan for the extra posts here rather than letting the budget pass hack them
  // off the end: a balanced eight-post thread reads better than a seven-post
  // one with a ragged tail.
  const neededGroups = Math.ceil(totalCharacters / budget);
  const target = Math.max(1, Math.min(Math.max(groupCount, neededGroups), sentences.length));
  const targetCharacters = Math.min(Math.ceil(totalCharacters / target), budget);

  const groups: string[][] = [];
  let current: string[] = [];
  let currentCharacters = 0;

  for (const [index, sentence] of sentences.entries()) {
    const remainingSentences = sentences.length - index;
    const remainingGroups = target - groups.length;

    // Every group still to be opened needs at least one sentence of its own.
    const mustCloseToFillRest = current.length > 0 && remainingSentences <= remainingGroups - 1;
    const shouldCloseForBalance =
      current.length > 0 &&
      remainingGroups > 1 &&
      currentCharacters >= targetCharacters &&
      remainingSentences > remainingGroups - 1;

    if (mustCloseToFillRest || shouldCloseForBalance) {
      groups.push(current);
      current = [];
      currentCharacters = 0;
    }

    current.push(sentence);
    currentCharacters += characterCount(sentence) + 1;
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Turns one group of sentences into as many posts as the budget requires —
 * normally exactly one.
 *
 * Cuts are taken at sentence boundaries first and word boundaries second. A
 * post never ends mid-word; the single exception is a token longer than the
 * whole budget (a pathological URL), where there is no boundary to use and the
 * alternative is a post that cannot be published at all.
 */
export function enforceBudget(sentences: readonly string[], budget: number): string[] {
  const posts: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.length > 0) posts.push(current);
    current = '';
  };

  for (const sentence of sentences) {
    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (characterCount(candidate) <= budget) {
      current = candidate;
      continue;
    }

    flush();
    if (characterCount(sentence) <= budget) {
      current = sentence;
      continue;
    }

    const chunks = splitAtWordBoundaries(sentence, budget);
    for (const chunk of chunks.slice(0, -1)) posts.push(chunk);
    current = chunks.at(-1) ?? '';
  }

  flush();
  return posts;
}

/** Packs words into chunks of at most `budget` characters. */
export function splitAtWordBoundaries(text: string, budget: number): string[] {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (characterCount(word) > budget) {
      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...hardSplit(word, budget));
      continue;
    }
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (characterCount(candidate) <= budget) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = word;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Last resort for a single token that cannot fit in a post on its own. */
function hardSplit(word: string, budget: number): string[] {
  const codePoints = Array.from(word);
  const chunks: string[] = [];
  for (let start = 0; start < codePoints.length; start += budget) {
    chunks.push(codePoints.slice(start, start + budget).join(''));
  }
  return chunks;
}

function buildThreadExplanation(input: {
  readonly requested: number;
  readonly produced: number;
  readonly budget: number;
  readonly translationExplanation: string;
}): string {
  const parts = [
    `Translated as a single narrative of ${String(input.requested)} posts, then split back on sentence boundaries within ${String(input.budget)} characters per post.`,
  ];

  if (input.produced > input.requested) {
    parts.push(
      `The Arabic needed ${String(input.produced)} posts: some sentences no longer fit the character budget of their original post.`,
    );
  } else if (input.produced < input.requested) {
    parts.push(
      `The Arabic fitted into ${String(input.produced)} posts: it is more compact than the source, and no post was split mid-sentence to pad the count.`,
    );
  }

  parts.push(input.translationExplanation);
  return truncate(parts.join(' '), 600);
}
