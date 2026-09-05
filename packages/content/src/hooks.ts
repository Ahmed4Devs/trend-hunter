import {
  LlmProviderError,
  X_POST_CHARACTER_LIMIT,
  characterCount,
  clamp,
  clamp01,
  contentHash,
  round,
  sanitizeText,
  toLatinDigits,
  tokenize,
} from '@trendhunter/shared';
import type {
  ContentLanguage,
  ContentTone,
  GenerationContext,
  LlmProvider,
} from '@trendhunter/types';

import { angleAt, buildPrompt, characterBudgetFor } from './prompts';
import { callProvider, fitToBudget, parseGeneratedPost } from './provider-output';

/**
 * Hook generation and hook scoring.
 *
 * A thread lives or dies on its first post, and asking a model for "the best
 * hook" just moves the judgement inside the model, where it is neither
 * inspectable nor reproducible. Instead several candidates are generated and
 * ranked here by a deterministic score, so the same candidates always produce
 * the same winner and a reviewer can see why.
 */

/**
 * Hook score weights.
 *
 *   HookScore = 30% Specificity
 *             + 30% CuriosityGap
 *             + 20% Concreteness
 *             + 20% Length
 */
export const HOOK_WEIGHTS = {
  specificity: 0.3,
  curiosityGap: 0.3,
  concreteness: 0.2,
  length: 0.2,
} as const;

/** How specificity is composed, before the vagueness penalty. */
const SPECIFICITY_SHARES = { topic: 0.5, properNouns: 0.3, interests: 0.2 } as const;
const VAGUENESS_PENALTY = 0.3;

/** How the curiosity gap is composed. */
const CURIOSITY_SHARES = { cues: 0.4, question: 0.35, colonLead: 0.25 } as const;

/** How concreteness is composed. */
const CONCRETENESS_SHARES = { number: 0.55, verb: 0.45 } as const;

/**
 * Length window, in the code points X counts.
 *
 * Under ~45 characters a hook cannot carry a specific claim; over ~110 it stops
 * being a hook and becomes the post. Scores fall off linearly to zero at the
 * outer bounds rather than cliff-edging, so a 120-character hook still competes.
 */
const LENGTH_IDEAL_MIN = 45;
const LENGTH_IDEAL_MAX = 110;
const LENGTH_FLOOR = 10;
const LENGTH_CEILING = 220;

/** Two cues are enough to signal an intent; more is not better. */
const CUE_SATURATION = 2;

/** A colon only works as a lead-in when it comes early. */
const COLON_LEAD_WINDOW = 40;

/** Candidates requested at most in one call. */
export const MAX_HOOK_CANDIDATES = 6;
export const DEFAULT_HOOK_CANDIDATES = 3;

/**
 * Words carrying no information. Filtered before overlap is measured so that
 * matching "the" against a topic name does not read as specificity.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'you',
  'are',
  'was',
  'were',
  'has',
  'have',
  'its',
  'about',
  'over',
  'new',
  'in',
  'on',
  'at',
  'by',
  'or',
  'be',
  'an',
  'we',
  'they',
  'their',
  'our',
  'can',
  'will',
  'just',
  'now',
  'من',
  'في',
  'على',
  'عن',
  'إلى',
  'الى',
  'هذا',
  'هذه',
  'التي',
  'الذي',
  'مع',
  'أن',
  'ان',
]);

/** Single-word curiosity signals. */
const CURIOSITY_WORDS: readonly string[] = [
  'why',
  'how',
  'nobody',
  'everyone',
  'quietly',
  'actually',
  'wrong',
  'mistake',
  'secret',
  'hidden',
  'ignored',
  'missed',
  'لماذا',
  'كيف',
  'لأن',
  'خطأ',
  'يتجاهل',
  'يغفل',
  'سر',
];

/** Multi-word curiosity signals, matched as substrings. */
const CURIOSITY_PHRASES: readonly string[] = [
  'no one',
  'most people',
  'the reason',
  "here's what",
  'here is what',
  'turns out',
  'what changed',
  'the catch',
  'لا أحد',
  'لا احد',
  'معظم الناس',
  'ما الذي',
  'السبب الحقيقي',
];

/** Words that promise significance without supplying any. */
const VAGUE_WORDS: readonly string[] = [
  'amazing',
  'incredible',
  'insane',
  'huge',
  'massive',
  'thing',
  'things',
  'stuff',
  'gamechanger',
  'revolutionary',
  'mindblowing',
  'مذهل',
  'خيالي',
  'رهيب',
  'أشياء',
  'اشياء',
];

const VAGUE_PHRASES: readonly string[] = [
  'game changer',
  'game-changer',
  'let that sink in',
  'you need to know',
  'this changes everything',
  'يغير كل شيء',
];

/**
 * Verbs that assert a change. Their presence is what separates "AI agents are
 * interesting" from "AI agents replace the integration layer".
 */
const STRONG_VERBS: readonly string[] = [
  'breaks',
  'break',
  'replaces',
  'replace',
  'kills',
  'kill',
  'cuts',
  'cut',
  'doubles',
  'double',
  'halves',
  'drops',
  'drop',
  'ships',
  'ship',
  'launches',
  'launch',
  'beats',
  'beat',
  'costs',
  'cost',
  'saves',
  'save',
  'proves',
  'prove',
  'fails',
  'fail',
  'wins',
  'win',
  'changes',
  'change',
  'moves',
  'rewrites',
  'يكسر',
  'يستبدل',
  'يضاعف',
  'يخفض',
  'يوفر',
  'يغير',
  'يثبت',
  'يطلق',
  'يفشل',
  'ينهي',
];

export interface HookScoreBreakdown {
  /** 0..100 — how tightly the hook is anchored to this topic and its terms. */
  readonly specificity: number;
  /** 0..100 — how strongly it makes the reader need the next line. */
  readonly curiosityGap: number;
  /** 0..100 — presence of a number and of a verb that asserts a change. */
  readonly concreteness: number;
  /** 0..100 — how close it sits to the length a hook works at. */
  readonly length: number;
  /** 0..100 weighted total. */
  readonly score: number;
}

export interface ScoredHook {
  readonly content: string;
  readonly characterCount: number;
  readonly score: number;
  readonly breakdown: HookScoreBreakdown;
}

/** The parts of a generation context hook scoring actually uses. */
export interface HookContext {
  readonly topicName?: string;
  readonly interests?: readonly string[];
}

/**
 * Scores one hook candidate. Pure and deterministic: the same text and the
 * same context always produce the same numbers, which is what lets the thread
 * generator pick a winner without a second model call.
 */
export function scoreHook(hook: string, context: HookContext = {}): HookScoreBreakdown {
  const text = sanitizeText(hook).replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return { specificity: 0, curiosityGap: 0, concreteness: 0, length: 0, score: 0 };
  }

  const lower = toLatinDigits(text).toLowerCase();
  const hookTokens = new Set(contentTokens(text));

  const specificity = clamp01(
    SPECIFICITY_SHARES.topic * overlapShare(context.topicName ?? '', hookTokens) +
      SPECIFICITY_SHARES.properNouns * properNounSignal(text) +
      SPECIFICITY_SHARES.interests * interestSignal(context.interests ?? [], hookTokens) -
      VAGUENESS_PENALTY * cueSignal(lower, hookTokens, VAGUE_WORDS, VAGUE_PHRASES),
  );

  const colonIndex = lower.indexOf(':');
  const curiosityGap = clamp01(
    CURIOSITY_SHARES.cues * cueSignal(lower, hookTokens, CURIOSITY_WORDS, CURIOSITY_PHRASES) +
      CURIOSITY_SHARES.question * (/[?؟]/u.test(text) ? 1 : 0) +
      CURIOSITY_SHARES.colonLead * (colonIndex > 0 && colonIndex < COLON_LEAD_WINDOW ? 1 : 0),
  );

  const concreteness = clamp01(
    CONCRETENESS_SHARES.number * (/\d/u.test(lower) ? 1 : 0) +
      CONCRETENESS_SHARES.verb * (containsAny(hookTokens, STRONG_VERBS) ? 1 : 0),
  );

  const length = lengthScore(characterCount(text));

  const total =
    specificity * HOOK_WEIGHTS.specificity +
    curiosityGap * HOOK_WEIGHTS.curiosityGap +
    concreteness * HOOK_WEIGHTS.concreteness +
    length * HOOK_WEIGHTS.length;

  return {
    specificity: round(specificity * 100, 1),
    curiosityGap: round(curiosityGap * 100, 1),
    concreteness: round(concreteness * 100, 1),
    length: round(length * 100, 1),
    score: round(total * 100, 1),
  };
}

/**
 * Ranks candidates strongest first.
 *
 * Duplicates (ignoring case, punctuation and URLs) collapse to one entry, and
 * ties break on the shorter text and then on the text itself, so the ordering
 * is total and does not depend on the order candidates arrived in.
 */
export function rankHooks(
  hooks: readonly string[],
  context: HookContext = {},
): readonly ScoredHook[] {
  const seen = new Set<string>();
  const scored: ScoredHook[] = [];
  for (const hook of hooks) {
    const content = sanitizeText(hook).replace(/\s+/g, ' ').trim();
    if (content.length === 0) continue;
    const fingerprint = contentHash(content);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const breakdown = scoreHook(content, context);
    scored.push({
      content,
      characterCount: characterCount(content),
      score: breakdown.score,
      breakdown,
    });
  }
  return scored.sort(compareHooks);
}

export function pickStrongestHook(
  hooks: readonly string[],
  context: HookContext = {},
): ScoredHook | null {
  return rankHooks(hooks, context)[0] ?? null;
}

export interface HookGenerationOptions {
  readonly count?: number;
  readonly language?: ContentLanguage;
  readonly tone?: ContentTone;
  /** Extra brief lines, e.g. the thread the hook has to open. */
  readonly directives?: readonly string[];
}

/**
 * Generates and ranks hook candidates.
 *
 * Each candidate is asked for under a different angle, because asking the same
 * model the same question twice returns the same sentence twice. A candidate
 * that fails validation is dropped rather than failing the batch; only a batch
 * with nothing usable in it is an error.
 */
export async function generateHooks(
  provider: LlmProvider,
  context: GenerationContext,
  options: HookGenerationOptions = {},
): Promise<readonly ScoredHook[]> {
  const count = clamp(Math.round(options.count ?? DEFAULT_HOOK_CANDIDATES), 1, MAX_HOOK_CANDIDATES);
  const budget = characterBudgetFor('HOOK') ?? X_POST_CHARACTER_LIMIT;

  const attempts = Array.from({ length: count }, (_unused, index) =>
    buildPrompt('HOOK', context, {
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.tone === undefined ? {} : { tone: options.tone }),
      ...(options.directives === undefined ? {} : { directives: options.directives }),
      angle: angleAt(index),
    }),
  );

  const settled = await Promise.allSettled(
    attempts.map(async (prompt) => {
      const reply = await callProvider(provider, prompt.request);
      const post = parseGeneratedPost(reply.value, reply.providerName);
      return fitToBudget(post.content, budget).text;
    }),
  );

  const candidates: string[] = [];
  let firstFailure: unknown;
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') candidates.push(outcome.value);
    else firstFailure ??= outcome.reason;
  }
  if (candidates.length === 0) {
    throw new LlmProviderError(provider.name, 'No usable hook was generated.', {
      cause: firstFailure,
    });
  }
  return rankHooks(candidates, context);
}

function compareHooks(a: ScoredHook, b: ScoredHook): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.characterCount !== b.characterCount) return a.characterCount - b.characterCount;
  return a.content < b.content ? -1 : a.content > b.content ? 1 : 0;
}

function contentTokens(value: string): string[] {
  return tokenize(value).filter((token) => !STOPWORDS.has(token));
}

/** Share of the reference's content words that the hook actually names. */
function overlapShare(reference: string, hookTokens: ReadonlySet<string>): number {
  const referenceTokens = contentTokens(reference);
  if (referenceTokens.length === 0) return 0;
  const unique = new Set(referenceTokens);
  let matched = 0;
  for (const token of unique) {
    if (hookTokens.has(token)) matched += 1;
  }
  return matched / unique.size;
}

function interestSignal(interests: readonly string[], hookTokens: ReadonlySet<string>): number {
  let matched = 0;
  for (const interest of interests) {
    if (contentTokens(interest).some((token) => hookTokens.has(token))) matched += 1;
  }
  return clamp01(matched / CUE_SATURATION);
}

/**
 * Proper nouns and acronyms, as a proxy for naming something real.
 *
 * The first word is skipped because a sentence starts with a capital anyway.
 * Arabic has no letter case, so Arabic hooks score here through the topic and
 * interest overlaps instead — which is why specificity does not lean on this
 * term alone.
 */
function properNounSignal(text: string): number {
  const words = text.split(/\s+/u).slice(1);
  let named = 0;
  for (const word of words) {
    const stripped = word.replace(/[^\p{L}\p{N}-]/gu, '');
    if (stripped.length < 2) continue;
    if (/^\p{Lu}/u.test(stripped) || /^[\p{Lu}\p{N}-]+$/u.test(stripped)) named += 1;
  }
  return clamp01(named / CUE_SATURATION);
}

function cueSignal(
  lower: string,
  tokens: ReadonlySet<string>,
  words: readonly string[],
  phrases: readonly string[],
): number {
  let matches = 0;
  for (const word of words) {
    if (tokens.has(word)) matches += 1;
  }
  for (const phrase of phrases) {
    if (lower.includes(phrase)) matches += 1;
  }
  return clamp01(matches / CUE_SATURATION);
}

function containsAny(tokens: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function lengthScore(count: number): number {
  if (count >= LENGTH_IDEAL_MIN && count <= LENGTH_IDEAL_MAX) return 1;
  if (count < LENGTH_IDEAL_MIN) {
    return clamp01((count - LENGTH_FLOOR) / (LENGTH_IDEAL_MIN - LENGTH_FLOOR));
  }
  return clamp01((LENGTH_CEILING - count) / (LENGTH_CEILING - LENGTH_IDEAL_MAX));
}
