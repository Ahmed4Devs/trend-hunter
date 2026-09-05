import {
  LlmProviderError,
  ValidationError,
  X_LONG_POST_CHARACTER_LIMIT,
  X_POST_CHARACTER_LIMIT,
  characterCount,
  clamp,
  contentHash,
  invariant,
  sanitizeText,
} from '@trendhunter/shared';
import type {
  ContentDraftKind,
  ContentLanguage,
  ContentTone,
  GenerationContext,
  LlmProvider,
} from '@trendhunter/types';

import type { PromptOptions, RegenerationAngle, RewriteOperation } from './prompts';
import {
  REWRITE_BRIEFS,
  angleAt,
  buildPrompt,
  characterBudgetFor,
  isStandardPostKind,
  nextAngle,
} from './prompts';
import { callProvider, fitToBudget, parseGeneratedPost } from './provider-output';

/**
 * The Content Studio engine for single drafts.
 *
 * The provider is injected, never constructed here: the studio has to work the
 * same way against the offline development provider and against a paid vendor,
 * and the tests need a provider they control. Nothing in this file knows which
 * one it is talking to.
 */

/** Fraction of the original length a "shorten" aims for. */
const SHORTEN_RATIO = 0.6;

/** Below this there is nothing left to cut without destroying the claim. */
const MIN_SHORTENABLE_CHARACTERS = 24;

/** Multiplier and minimum headroom applied by "expand". */
const EXPAND_FACTOR = 2;
const MIN_EXPANSION_ROOM = 80;

/** Angles tried before a regeneration is declared a failure. */
const REGENERATION_ATTEMPTS = 3;

/** Attempts allowed to produce something genuinely longer. */
const EXPANSION_ATTEMPTS = 2;

export const DEFAULT_CONTENT_IDEAS = 5;
export const MAX_CONTENT_IDEAS = 10;

/** Spare generations requested so duplicates can be discarded. */
const IDEA_SPARE_ATTEMPTS = 3;

/**
 * Where a draft goes when it is expanded past the ceiling of its own kind.
 * A hook grows into a post; a post grows into a long post; a long post has
 * nowhere left to go.
 */
const EXPANSION_KIND: Readonly<Record<ContentDraftKind, ContentDraftKind>> = {
  SHORT_X_POST: 'LONG_X_POST',
  LONG_X_POST: 'LONG_X_POST',
  X_THREAD: 'X_THREAD',
  EDUCATIONAL_POST: 'LONG_X_POST',
  OPINION_POST: 'LONG_X_POST',
  BUSINESS_ANGLE: 'LONG_X_POST',
  DEVELOPER_ANGLE: 'LONG_X_POST',
  SAUDI_MARKET_ANGLE: 'LONG_X_POST',
  SUMMARY: 'LONG_X_POST',
  HOOK: 'SHORT_X_POST',
  CONTENT_IDEA: 'SHORT_X_POST',
};

export interface DraftResult {
  readonly kind: ContentDraftKind;
  readonly language: ContentLanguage;
  readonly tone: ContentTone;
  readonly title: string | null;
  readonly content: string;
  /** Counted the way X counts it: code points, not UTF-16 units. */
  readonly characterCount: number;
  /** The ceiling this draft was held to. */
  readonly characterBudget: number;
  /** True when the provider overran the budget and the text was cut to fit. */
  readonly trimmed: boolean;
  readonly providerName: string;
  readonly providerModel: string;
  /** The lens this draft was written under, if any. */
  readonly angle: RegenerationAngle | null;
  /**
   * The brief this draft came from. Kept on the result so that regenerating or
   * rewriting needs nothing from the caller but the draft itself.
   */
  readonly context: GenerationContext;
}

export interface DraftOptions {
  readonly language?: ContentLanguage;
  readonly tone?: ContentTone;
}

export interface RewriteOptions extends DraftOptions {
  /** Free-text instruction from the user. Treated as untrusted input. */
  readonly instruction?: string;
}

/**
 * The single path every draft takes: build the brief, call the provider,
 * validate what comes back, hold it to its budget, and check the result against
 * the X limit before anyone can publish it.
 *
 * Exported because `ThreadService` condenses a thread back into a post and must
 * go through exactly the same gate.
 */
export async function generatePost(
  provider: LlmProvider,
  kind: ContentDraftKind,
  context: GenerationContext,
  options: PromptOptions = {},
): Promise<DraftResult> {
  const prompt = buildPrompt(kind, context, options);
  const reply = await callProvider(provider, prompt.request);
  const post = parseGeneratedPost(reply.value, reply.providerName);
  const budget = prompt.budget ?? X_POST_CHARACTER_LIMIT;
  const fitted = fitToBudget(post.content, budget);
  const count = assertWithinPostLimit(kind, fitted.text);

  return {
    kind,
    language: prompt.language,
    tone: prompt.tone,
    title: post.title,
    content: fitted.text,
    characterCount: count,
    characterBudget: budget,
    trimmed: fitted.trimmed,
    providerName: reply.providerName,
    providerModel: reply.providerModel,
    angle: options.angle ?? null,
    context,
  };
}

export class ContentService {
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  /**
   * Generates one draft of `kind`.
   *
   * Threads are rejected rather than silently downgraded: they have a different
   * result shape and a different set of guarantees, so they belong to
   * `ThreadService`.
   */
  async generateDraft(
    kind: ContentDraftKind,
    context: GenerationContext,
    options: DraftOptions = {},
  ): Promise<DraftResult> {
    if (kind === 'X_THREAD') {
      throw new ValidationError('Threads are generated by ThreadService.generateThread.');
    }
    return this.produce(kind, context, toPromptOptions(options));
  }

  /**
   * Produces a different take on the same topic.
   *
   * Each attempt uses the next angle in the rotation and is told not to reuse
   * the previous wording. A provider that answers with the same text under
   * every angle is broken, and saying so is more useful than handing the user
   * back the draft they already have.
   */
  async regenerate(draft: DraftResult, options: DraftOptions = {}): Promise<DraftResult> {
    let angle = draft.angle;
    for (let attempt = 0; attempt < REGENERATION_ATTEMPTS; attempt += 1) {
      angle = nextAngle(angle);
      const candidate = await this.produce(draft.kind, draft.context, {
        language: options.language ?? draft.language,
        tone: options.tone ?? draft.tone,
        maxCharacters: draft.characterBudget,
        angle,
        avoid: draft.content,
        directives: [
          'Keep the subject identical. Change the argument, the structure and the examples.',
        ],
      });
      if (!isSameContent(candidate.content, draft.content)) return candidate;
    }
    throw new LlmProviderError(
      this.provider.name,
      'The provider returned the same draft under every angle.',
      { details: { kind: draft.kind, attempts: REGENERATION_ATTEMPTS } },
    );
  }

  /**
   * Shortens a draft. The target is strictly below the current length and the
   * budget is enforced on the way out, so the result is always shorter than the
   * input — a model that ignores the brief cannot defeat this.
   */
  async shorten(draft: DraftResult, options: DraftOptions = {}): Promise<DraftResult> {
    if (draft.characterCount <= MIN_SHORTENABLE_CHARACTERS) {
      throw new ValidationError('This draft is already too short to shorten further.');
    }
    const target = Math.max(
      1,
      Math.min(draft.characterCount - 1, Math.round(draft.characterCount * SHORTEN_RATIO)),
    );
    return this.rework(draft, 'shorten', { maxCharacters: target, ...options });
  }

  /**
   * Expands a draft, promoting it to a longer kind when its own ceiling no
   * longer leaves room. Unlike shortening, length cannot be forced on the way
   * out — text can be cut but not invented — so a provider that returns
   * something no longer than the original is retried and then reported.
   */
  async expand(draft: DraftResult, options: DraftOptions = {}): Promise<DraftResult> {
    const { kind, target } = expansionTarget(draft);
    if (target <= draft.characterCount) {
      throw new ValidationError('This draft is already at the maximum length for its kind.');
    }
    for (let attempt = 0; attempt < EXPANSION_ATTEMPTS; attempt += 1) {
      const candidate = await this.rework(draft, 'expand', {
        kind,
        maxCharacters: target,
        ...options,
        ...(attempt === 0
          ? {}
          : {
              directives: [
                `The previous attempt came back no longer than the original. Add at least ${
                  target - draft.characterCount
                } characters of new substance.`,
              ],
            }),
      });
      if (candidate.characterCount > draft.characterCount) return candidate;
    }
    throw new LlmProviderError(
      this.provider.name,
      'The provider returned a draft no longer than the original.',
      { details: { kind: draft.kind, target } },
    );
  }

  /** Rewrites the draft in a different tone, leaving the claim and facts alone. */
  async changeTone(
    draft: DraftResult,
    tone: ContentTone,
    options: DraftOptions = {},
  ): Promise<DraftResult> {
    return this.rework(draft, 'change-tone', { ...options, tone });
  }

  /**
   * Rewrites the draft, optionally following a user instruction. The
   * instruction is sanitised and length-bounded before it reaches the brief: it
   * is typed by a person and lands next to third-party excerpts in the prompt.
   */
  async rewrite(draft: DraftResult, options: RewriteOptions = {}): Promise<DraftResult> {
    const instruction = sanitizeText(options.instruction ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return this.rework(draft, 'rewrite', {
      language: options.language,
      tone: options.tone,
      ...(instruction.length === 0
        ? {}
        : { directives: [`Follow this instruction from the user: ${instruction}`] }),
    });
  }

  /**
   * Generates distinct content ideas.
   *
   * Spare candidates are requested so that near-identical ideas can be dropped
   * — duplicates are detected with the same content fingerprint the ingestion
   * pipeline uses, which ignores case, punctuation and URLs. A candidate that
   * fails validation is dropped rather than failing the batch.
   */
  async generateIdeas(
    context: GenerationContext,
    count: number = DEFAULT_CONTENT_IDEAS,
    options: DraftOptions = {},
  ): Promise<readonly DraftResult[]> {
    const wanted = clamp(Math.round(count), 1, MAX_CONTENT_IDEAS);
    const attempts = wanted + IDEA_SPARE_ATTEMPTS;

    const settled = await Promise.allSettled(
      Array.from({ length: attempts }, (_unused, index) =>
        this.produce('CONTENT_IDEA', context, {
          ...toPromptOptions(options),
          angle: angleAt(index),
          directives: [
            `This is proposal ${index + 1} of ${attempts}; it must not overlap with the others.`,
            'Propose an idea that is not a restatement of the topic summary.',
          ],
        }),
      ),
    );

    const ideas: DraftResult[] = [];
    const seen = new Set<string>();
    let firstFailure: unknown;
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        firstFailure ??= outcome.reason;
        continue;
      }
      const fingerprint = contentHash(outcome.value.content);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      ideas.push(outcome.value);
      if (ideas.length === wanted) break;
    }
    if (ideas.length === 0) {
      throw new LlmProviderError(this.provider.name, 'No usable content idea was generated.', {
        cause: firstFailure,
      });
    }
    return ideas;
  }

  private async produce(
    kind: ContentDraftKind,
    context: GenerationContext,
    options: PromptOptions,
  ): Promise<DraftResult> {
    return generatePost(this.provider, kind, context, options);
  }

  /** Shared body of every rewrite operation the UI offers. */
  private async rework(
    draft: DraftResult,
    operation: RewriteOperation,
    overrides: {
      readonly kind?: ContentDraftKind;
      readonly language?: ContentLanguage;
      readonly tone?: ContentTone;
      readonly maxCharacters?: number;
      readonly directives?: readonly string[];
    },
  ): Promise<DraftResult> {
    const kind = overrides.kind ?? draft.kind;
    return this.produce(kind, draft.context, {
      language: overrides.language ?? draft.language,
      tone: overrides.tone ?? draft.tone,
      maxCharacters: overrides.maxCharacters ?? draft.characterBudget,
      sourceText: draft.content,
      directives: [...REWRITE_BRIEFS[operation], ...(overrides.directives ?? [])],
      ...(draft.angle === null ? {} : { angle: draft.angle }),
    });
  }
}

/**
 * The last gate before a draft is returned. The budgets in the prompt catalogue
 * already keep drafts inside these limits, so a violation here means a bug in
 * this package rather than bad provider output — hence an invariant, not a
 * validation error.
 */
function assertWithinPostLimit(kind: ContentDraftKind, text: string): number {
  const count = characterCount(text);
  const limit = isStandardPostKind(kind) ? X_POST_CHARACTER_LIMIT : X_LONG_POST_CHARACTER_LIMIT;
  invariant(count <= limit, `${kind} draft of ${count} characters exceeds the X limit of ${limit}`);
  return count;
}

function expansionTarget(draft: DraftResult): {
  readonly kind: ContentDraftKind;
  readonly target: number;
} {
  const ownCeiling = characterBudgetFor(draft.kind) ?? X_LONG_POST_CHARACTER_LIMIT;
  const kind =
    ownCeiling - draft.characterCount >= MIN_EXPANSION_ROOM
      ? draft.kind
      : EXPANSION_KIND[draft.kind];
  const ceiling = characterBudgetFor(kind) ?? X_LONG_POST_CHARACTER_LIMIT;
  const target = clamp(
    Math.max(draft.characterCount + MIN_EXPANSION_ROOM, Math.round(draft.characterCount * EXPAND_FACTOR)),
    1,
    ceiling,
  );
  return { kind, target };
}

/** Two drafts count as the same when their content fingerprints match. */
function isSameContent(a: string, b: string): boolean {
  return contentHash(a) === contentHash(b);
}

function toPromptOptions(options: DraftOptions): PromptOptions {
  return {
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.tone === undefined ? {} : { tone: options.tone }),
  };
}
