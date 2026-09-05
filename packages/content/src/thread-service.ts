import {
  DEFAULT_THREAD_LENGTH,
  MAX_THREAD_LENGTH,
  MIN_THREAD_LENGTH,
  THREAD_COUNTER_RESERVED_CHARACTERS,
  ValidationError,
  X_POST_CHARACTER_LIMIT,
  characterCount,
  clamp,
  invariant,
  sanitizeText,
} from '@trendhunter/shared';
import type {
  ContentLanguage,
  ContentTone,
  GenerationContext,
  LlmProvider,
} from '@trendhunter/types';

import type { DraftOptions, DraftResult } from './content-service';
import { generatePost } from './content-service';
import {
  DEFAULT_HOOK_CANDIDATES,
  MAX_HOOK_CANDIDATES,
  generateHooks,
  pickStrongestHook,
  rankHooks,
} from './hooks';
import { MAX_TITLE_CHARACTERS, THREAD_POST_CHARACTER_BUDGET, buildPrompt } from './prompts';
import { callProvider, fitToBudget, parseGeneratedThread } from './provider-output';

/**
 * Thread generation and thread/post conversion.
 *
 * A thread has a shape the UI depends on — a hook that stands alone, body posts
 * that each carry one idea, and a conclusion that asks for something — and that
 * shape is enforced here rather than hoped for from the model. The splitter is
 * a pure function so the character arithmetic can be tested exhaustively
 * against Arabic, emoji and URLs without a provider in the way.
 */

/**
 * Sentence terminators, Latin and Arabic. `؟` is the Arabic question mark and
 * `۔` the Arabic full stop; both appear in Arabic technical writing alongside
 * the Latin punctuation, so both scripts are handled by one pass.
 */
const SENTENCE_END = /[.!?…؟۔]+["'’”)\]]*\s+/u;

/** Phrases that already read as a call to action, in either language. */
const CALL_TO_ACTION_CUES: readonly string[] = [
  'follow',
  'reply',
  'repost',
  'retweet',
  'share',
  'bookmark',
  'let me know',
  'what do you think',
  'تابع',
  'شارك',
  'رأيك',
  'احفظ',
  'أخبرني',
];

const CALL_TO_ACTION: Readonly<Record<ContentLanguage, string>> = {
  EN: 'If this was useful, follow for more and share it with someone building in this space.',
  AR: 'إذا كان هذا مفيدًا، تابعني للمزيد وشاركه مع من يعمل في هذا المجال.',
  OTHER: 'If this was useful, follow for more and share it with someone building in this space.',
};

/** Extra posts allowed beyond the ones needed to hold an expanded post's text. */
const EXPANSION_HEADROOM_POSTS = 2;

export interface ThreadPostDraft {
  /** 1-based position, matching `ThreadPost.position` in the domain model. */
  readonly position: number;
  readonly content: string;
  readonly characterCount: number;
}

export interface ThreadResult {
  readonly title: string;
  readonly language: ContentLanguage;
  readonly tone: ContentTone;
  readonly posts: readonly ThreadPostDraft[];
  readonly providerName: string;
  readonly providerModel: string;
  /** The brief this thread came from, so a conversion needs nothing else. */
  readonly context: GenerationContext;
}

export interface ThreadOptions extends DraftOptions {
  readonly length?: number;
  /**
   * Hook candidates generated and ranked before post 1 is chosen. Zero keeps
   * whatever the provider produced as its first post.
   */
  readonly hookCandidates?: number;
}

/** A post being expanded into a thread; a `DraftResult` satisfies this. */
export interface SourcePost {
  readonly content: string;
  readonly context: GenerationContext;
}

export interface SplitOptions {
  /** Hard limit for one post before the counter is reserved. */
  readonly maxCharacters?: number;
  /** Room kept for the `n/N` counter the client renders. */
  readonly reserveForCounter?: number;
}

/**
 * Splits long text into thread posts.
 *
 * Pure and lossless: nothing is dropped, so a caller that needs a maximum post
 * count applies it afterwards and can see what it is discarding.
 *
 * Characters are counted as X counts them — code points, via `characterCount`
 * — so an emoji costs one unit rather than the two `String#length` reports.
 * Breaks are taken at sentence boundaries first and word boundaries second; a
 * single token longer than the whole budget (a very long URL is the realistic
 * case) is the one thing that must be cut through, because leaving it whole
 * would produce a post that cannot be published.
 */
export function splitIntoThreadPosts(
  text: string,
  options: SplitOptions = {},
): readonly ThreadPostDraft[] {
  const limit = options.maxCharacters ?? X_POST_CHARACTER_LIMIT;
  const reserved = options.reserveForCounter ?? THREAD_COUNTER_RESERVED_CHARACTERS;
  const budget = Math.max(1, Math.round(limit - reserved));

  const clean = sanitizeText(text);
  if (clean.length === 0) return [];

  const chunks: string[] = [];
  let current = '';
  let currentBlock = -1;

  for (const unit of toUnits(clean)) {
    const separator = current.length === 0 ? '' : unit.block === currentBlock ? ' ' : '\n';
    const candidate = `${current}${separator}${unit.text}`;
    if (characterCount(candidate) <= budget) {
      current = candidate;
      currentBlock = unit.block;
      continue;
    }
    if (current.length > 0) chunks.push(current);
    const pieces = splitOversizedUnit(unit.text, budget);
    for (let index = 0; index < pieces.length - 1; index += 1) {
      const piece = pieces[index];
      if (piece !== undefined) chunks.push(piece);
    }
    current = pieces[pieces.length - 1] ?? '';
    currentBlock = unit.block;
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((content, index) => ({
    position: index + 1,
    content,
    characterCount: characterCount(content),
  }));
}

export class ThreadService {
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  /**
   * Generates a thread of the requested length.
   *
   * The provider's own first post competes with freshly generated hook
   * candidates and the strongest wins on the deterministic hook score, so the
   * opening post is never left to whichever sentence the model happened to
   * emit first.
   */
  async generateThread(
    context: GenerationContext,
    options: ThreadOptions = {},
  ): Promise<ThreadResult> {
    return this.build(context, options, {});
  }

  /**
   * Expands a single post into a thread. The thread length defaults to what the
   * post's own length suggests, plus room for the evidence it had no space for.
   */
  async threadFromPost(post: SourcePost, options: ThreadOptions = {}): Promise<ThreadResult> {
    const content = sanitizeText(post.content);
    if (content.length === 0) {
      throw new ValidationError('The post has no content to expand.');
    }
    return this.build(
      post.context,
      { ...options, length: options.length ?? suggestedThreadLength(content) },
      {
        sourceText: content,
        directives: [
          'Expand the post below into a thread.',
          'Keep its claim and every fact in it; add the evidence, the mechanism and the consequence it had no room for.',
          'Do not chop the post into fragments — each thread post must be able to stand on its own.',
        ],
      },
    );
  }

  /**
   * Condenses a thread into one post.
   *
   * The claim to keep is chosen with the same hook score used to pick an
   * opening post, over the thread's own posts: the strongest-scoring post is
   * the one carrying the specific, concrete claim, and the closing
   * call-to-action post is excluded because it makes no claim at all.
   */
  async postFromThread(thread: ThreadResult, options: DraftOptions = {}): Promise<DraftResult> {
    if (thread.posts.length === 0) {
      throw new ValidationError('The thread has no posts to condense.');
    }
    const contents = thread.posts.map((post) => post.content);
    const claimCandidates = contents.length > 1 ? contents.slice(0, -1) : contents;
    const strongest = rankHooks(claimCandidates, thread.context)[0];

    return generatePost(this.provider, 'SHORT_X_POST', thread.context, {
      language: options.language ?? thread.language,
      tone: options.tone ?? thread.tone,
      sourceText: contents.join('\n\n'),
      directives: [
        'Condense the thread below into a single post.',
        ...(strongest === undefined
          ? []
          : [`The claim the post must keep is: ${strongest.content}`]),
        'Drop supporting detail rather than compressing every post into a clause; a list of fragments is not a post.',
      ],
    });
  }

  /** Shared body of thread generation and post expansion. */
  private async build(
    context: GenerationContext,
    options: ThreadOptions,
    extras: { readonly sourceText?: string; readonly directives?: readonly string[] },
  ): Promise<ThreadResult> {
    const length = clamp(
      Math.round(options.length ?? DEFAULT_THREAD_LENGTH),
      MIN_THREAD_LENGTH,
      MAX_THREAD_LENGTH,
    );
    const prompt = buildPrompt('X_THREAD', context, {
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.tone === undefined ? {} : { tone: options.tone }),
      ...extras,
      threadLength: length,
    });

    const reply = await callProvider(this.provider, prompt.request);
    const generated = parseGeneratedThread(reply.value, reply.providerName, MIN_THREAD_LENGTH);
    const raw = generated.posts.map((post) => post.content);

    const first = raw[0] ?? '';
    const last = raw[raw.length - 1] ?? '';
    const hook = await this.selectHook(context, first, options, prompt.language, prompt.tone);
    const conclusion = withCallToAction(last, prompt.language);

    const body = raw
      .slice(1, -1)
      .flatMap((text) => splitIntoThreadPosts(text).map((post) => post.content));

    const contents = [hook, ...body.slice(0, Math.max(0, length - 2)), conclusion];
    const posts = contents.map((content, index) => ({
      position: index + 1,
      content,
      characterCount: characterCount(content),
    }));
    for (const post of posts) {
      invariant(
        post.characterCount <= THREAD_POST_CHARACTER_BUDGET,
        `thread post ${post.position} of ${post.characterCount} characters exceeds the per-post budget`,
      );
    }

    return {
      title: threadTitle(generated.title, context.topicName),
      language: prompt.language,
      tone: prompt.tone,
      posts,
      providerName: reply.providerName,
      providerModel: reply.providerModel,
      context,
    };
  }

  /**
   * Picks the opening post: the provider's own first post ranked against freshly
   * generated candidates.
   *
   * A failure to generate candidates is not fatal — the thread itself is already
   * in hand, and returning it with the provider's own hook is a better outcome
   * for the user than discarding a good thread over an optional extra call.
   */
  private async selectHook(
    context: GenerationContext,
    providerHook: string,
    options: ThreadOptions,
    language: ContentLanguage,
    tone: ContentTone,
  ): Promise<string> {
    const fitted = fitToBudget(providerHook, THREAD_POST_CHARACTER_BUDGET).text;
    const count = clamp(
      Math.round(options.hookCandidates ?? DEFAULT_HOOK_CANDIDATES),
      0,
      MAX_HOOK_CANDIDATES,
    );
    if (count === 0) return fitted;

    try {
      const candidates = await generateHooks(this.provider, context, {
        count,
        language,
        tone,
        directives: [
          'This hook opens a thread; the posts after it deliver on whatever it promises.',
        ],
      });
      const pool = [fitted, ...candidates.map((candidate) => candidate.content)];
      return pickStrongestHook(pool, context)?.content ?? fitted;
    } catch {
      return fitted;
    }
  }
}

/** A block of text and the source line it came from. */
interface TextUnit {
  readonly text: string;
  readonly block: number;
}

/**
 * Sentences, tagged with the line they came from so that packing can rejoin
 * sentences with a space but keep a line break between separate lines — which
 * is what preserves a list or a stanza through a split.
 */
function toUnits(text: string): readonly TextUnit[] {
  const units: TextUnit[] = [];
  const blocks = text.split(/\n+/u);
  for (let block = 0; block < blocks.length; block += 1) {
    const line = blocks[block]?.trim() ?? '';
    if (line.length === 0) continue;
    for (const sentence of splitSentences(line)) {
      units.push({ text: sentence, block });
    }
  }
  return units;
}

function splitSentences(line: string): readonly string[] {
  const sentences: string[] = [];
  let rest = line;
  let guard = SENTENCE_END.exec(rest);
  while (guard !== null) {
    const end = guard.index + guard[0].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    rest = rest.slice(end);
    guard = SENTENCE_END.exec(rest);
  }
  const tail = rest.trim();
  if (tail.length > 0) sentences.push(tail);
  return sentences;
}

/**
 * Breaks one oversized sentence into budget-sized pieces on word boundaries.
 * A word that is itself longer than the budget is cut on code point boundaries,
 * because there is no boundary left to use.
 */
function splitOversizedUnit(unit: string, budget: number): readonly string[] {
  const pieces: string[] = [];
  let current = '';
  for (const word of unit.split(/\s+/u)) {
    if (word.length === 0) continue;
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (characterCount(candidate) <= budget) {
      current = candidate;
      continue;
    }
    if (current.length > 0) pieces.push(current);
    if (characterCount(word) <= budget) {
      current = word;
      continue;
    }
    for (const fragment of cutIntoFragments(word, budget)) {
      pieces.push(fragment);
    }
    const trailing = pieces.pop();
    current = trailing ?? '';
  }
  if (current.length > 0) pieces.push(current);
  return pieces.length > 0 ? pieces : [''];
}

/** Hard-cuts an unbreakable token on code point boundaries. */
function cutIntoFragments(word: string, budget: number): readonly string[] {
  const points = Array.from(word);
  const fragments: string[] = [];
  for (let index = 0; index < points.length; index += budget) {
    fragments.push(points.slice(index, index + budget).join(''));
  }
  return fragments;
}

/**
 * Guarantees the closing post asks for something. When the model already did,
 * its wording is kept; otherwise room is made for the standard call to action,
 * because a thread that ends without one is the single most common reason a
 * good thread goes nowhere.
 */
function withCallToAction(text: string, language: ContentLanguage): string {
  const clean = sanitizeText(text);
  const lower = clean.toLowerCase();
  if (CALL_TO_ACTION_CUES.some((cue) => lower.includes(cue))) {
    return fitToBudget(clean, THREAD_POST_CHARACTER_BUDGET).text;
  }
  const cta = CALL_TO_ACTION[language];
  const room = Math.max(1, THREAD_POST_CHARACTER_BUDGET - characterCount(cta) - 1);
  const body = fitToBudget(clean, room).text;
  return body.length === 0 ? cta : `${body}\n${cta}`;
}

/** Posts needed to carry the text, plus room for what it left out. */
function suggestedThreadLength(content: string): number {
  const needed = Math.ceil(characterCount(content) / THREAD_POST_CHARACTER_BUDGET);
  return clamp(needed + EXPANSION_HEADROOM_POSTS, MIN_THREAD_LENGTH, MAX_THREAD_LENGTH);
}

function threadTitle(providerTitle: string, topicName: string): string {
  const title = sanitizeText(providerTitle).replace(/\s+/g, ' ').trim();
  const fallback = sanitizeText(topicName).replace(/\s+/g, ' ').trim();
  return fitToBudget(title.length > 0 ? title : fallback, MAX_TITLE_CHARACTERS).text;
}
