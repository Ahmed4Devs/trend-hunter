import type { ContentLanguage, TranslationMode } from '@trendhunter/types';

import {
  ArabicOptimizerService,
  PROSE_SENTENCE_WORD_LIMIT,
  X_SENTENCE_WORD_LIMIT,
} from './arabic-optimizer-service';
import type { GlossaryEntry } from './terminology-service';

/**
 * Tone. What separates the five translation modes from each other.
 *
 * Every mode produces a *correct* translation; they disagree about register,
 * sentence length and how much of the English sentence structure survives. The
 * rules are declared as data rather than buried in prompt strings for one
 * reason: the model is advisory and the post-processing is not. Asking for
 * "short sentences" gets short sentences most of the time; enforcing a
 * fourteen-word ceiling afterwards gets them every time.
 *
 * `X_STYLE` is the default and the one that matters. Arabic technical content
 * on X fails in a predictable way — it reads like a translated press release:
 * long subordinate clauses, formal connectors, a register nobody uses in a
 * timeline. The mode exists to prevent that specific failure while leaving the
 * technical meaning exactly where the source put it.
 */

export const FORMALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Formality = (typeof FORMALITY_LEVELS)[number];

export interface ModeProfile {
  readonly mode: TranslationMode;
  readonly label: string;
  readonly arabicLabel: string;
  readonly formality: Formality;
  readonly maxSentenceWords: number;
  /** Whether the literal-translation filler phrases are removed afterwards. */
  readonly stripConnectors: boolean;
  readonly splitSentences: boolean;
  /** Whether the mode may substitute an Arabic idiom for an English one. */
  readonly allowsIdiom: boolean;
  /** Whether formal vocabulary is simplified after the model answers. */
  readonly simplifiesVocabulary: boolean;
  /** Handed to the model, one instruction per line. */
  readonly directives: readonly string[];
  /** What this mode changes relative to a word-for-word rendering. */
  readonly changes: string;
}

/**
 * A sentence budget high enough never to bite. `LITERAL` must not restructure
 * anything, and a numeric ceiling reads better here than a nullable field.
 */
const NO_SENTENCE_LIMIT = 1_000;

const MODE_PROFILES: Readonly<Record<TranslationMode, ModeProfile>> = {
  LITERAL: {
    mode: 'LITERAL',
    label: 'Literal',
    arabicLabel: 'حرفية',
    formality: 'MEDIUM',
    maxSentenceWords: NO_SENTENCE_LIMIT,
    stripConnectors: false,
    splitSentences: false,
    allowsIdiom: false,
    simplifiesVocabulary: false,
    directives: [
      'Translate sentence by sentence and keep the original sentence order and boundaries.',
      'Do not merge, split, shorten or reorder sentences.',
      'Prefer the direct Arabic equivalent of each word over an idiomatic paraphrase.',
    ],
    changes:
      'Keeps the source structure intact: same sentences, same order, no rewriting. Only mechanical fixes (digits, spacing, ligatures) are applied afterwards.',
  },
  NATURAL: {
    mode: 'NATURAL',
    label: 'Natural',
    arabicLabel: 'طبيعية',
    formality: 'MEDIUM',
    maxSentenceWords: PROSE_SENTENCE_WORD_LIMIT,
    stripConnectors: true,
    splitSentences: true,
    allowsIdiom: true,
    simplifiesVocabulary: false,
    directives: [
      'Translate the meaning, not the words: write what an Arabic writer would write.',
      'Reorder clauses where Arabic word order calls for it.',
      'Use an Arabic idiom when the English one has a real equivalent; otherwise say it plainly.',
    ],
    changes:
      'Rewrites for Arabic word order and drops the filler a literal rendering produces, while keeping paragraph-length sentences.',
  },
  X_STYLE: {
    mode: 'X_STYLE',
    label: 'X style',
    arabicLabel: 'أسلوب إكس',
    formality: 'LOW',
    maxSentenceWords: X_SENTENCE_WORD_LIMIT,
    stripConnectors: true,
    splitSentences: true,
    allowsIdiom: true,
    simplifiesVocabulary: false,
    directives: [
      'Write natural Arabic for a technical audience on X — engaging, never stiff.',
      'Short sentences. One idea per sentence.',
      'No formal opening formulas and no filler connectors.',
      'Keep every technical claim, number and name exactly as accurate as the source.',
      'Address the reader directly where the source does; do not add hype the source does not carry.',
    ],
    changes:
      'Drops the formal register and the connector filler, and holds sentences to about fourteen words so each one lands in a timeline. Meaning and technical accuracy are unchanged.',
  },
  PROFESSIONAL: {
    mode: 'PROFESSIONAL',
    label: 'Professional',
    arabicLabel: 'مهنية',
    formality: 'HIGH',
    maxSentenceWords: PROSE_SENTENCE_WORD_LIMIT,
    stripConnectors: false,
    splitSentences: true,
    allowsIdiom: false,
    simplifiesVocabulary: false,
    directives: [
      'Use Modern Standard Arabic suitable for a business report or a newsletter.',
      'Keep the formal connectives that carry the argument between sentences.',
      'No colloquialism, no contraction of the register, no direct address.',
    ],
    changes:
      'Holds a formal register and keeps the connectives that structure an argument; only over-long sentences are split.',
  },
  SIMPLE_ARABIC: {
    mode: 'SIMPLE_ARABIC',
    label: 'Simple Arabic',
    arabicLabel: 'عربية مبسّطة',
    formality: 'LOW',
    maxSentenceWords: X_SENTENCE_WORD_LIMIT,
    stripConnectors: true,
    splitSentences: true,
    allowsIdiom: false,
    simplifiesVocabulary: true,
    directives: [
      'Use the simplest Arabic word that carries the meaning.',
      'Short sentences, active voice, no subordinate clauses stacked on each other.',
      'Explain a technical term in a few words the first time it appears, then use it plainly.',
    ],
    changes:
      'Replaces heavy classical vocabulary with everyday equivalents and keeps sentences short, for readers who are not native to formal written Arabic.',
  },
};

/**
 * Formal words swapped for everyday ones under `SIMPLE_ARABIC`.
 *
 * Each pair is meaning-preserving — this is register, not paraphrase. Anything
 * that would shift the claim being made stays out of the table.
 */
const SIMPLE_VOCABULARY: readonly (readonly [RegExp, string])[] = [
  [/يتوجب/gu, 'يجب'],
  [/نظرا?ً? لأن/gu, 'لأن'],
  [/بناءً على ذلك/gu, 'لذلك'],
  [/إلا أن(?:ه|ها)?/gu, 'لكن'],
  [/الأمر الذي/gu, 'ما'],
  [/إذ أن/gu, 'لأن'],
  [/حينئذٍ|حينئذ/gu, 'عندها'],
  [/لا يزال/gu, 'ما زال'],
  [/حيال/gu, 'تجاه'],
  [/إثر ذلك/gu, 'بعدها'],
  [/من ثم/gu, 'ثم'],
];

export interface LocalizationResult {
  readonly text: string;
  readonly mode: TranslationMode;
  /** Rule names that fired, for the explanation shown to the user. */
  readonly appliedRules: readonly string[];
}

export interface GuidanceInput {
  readonly mode: TranslationMode;
  readonly targetLanguage: ContentLanguage;
  /** Placeholders the model must copy through verbatim. */
  readonly protectedTokens: readonly string[];
  readonly glossary: readonly GlossaryEntry[];
  /** The surrounding narrative, when one segment of a thread is translated. */
  readonly contextSummary?: string;
}

export class LocalizationService {
  private readonly optimizer: ArabicOptimizerService;

  constructor(optimizer: ArabicOptimizerService = new ArabicOptimizerService()) {
    this.optimizer = optimizer;
  }

  profileFor(mode: TranslationMode): ModeProfile {
    return MODE_PROFILES[mode];
  }

  /** One sentence on what the mode does, for the Translations page. */
  describe(mode: TranslationMode): string {
    return MODE_PROFILES[mode].changes;
  }

  /**
   * The instruction block handed to the provider.
   *
   * It travels in `TranslateRequest.contextSummary` because that is the only
   * free-text channel the provider contract exposes; the surrounding narrative,
   * when there is one, is appended below the instructions rather than replacing
   * them.
   */
  buildGuidance(input: GuidanceInput): string {
    const profile = MODE_PROFILES[input.mode];
    const sections: string[] = [
      `Mode: ${profile.label} (${profile.formality} formality).`,
      ...profile.directives.map((directive) => `- ${directive}`),
    ];

    if (input.protectedTokens.length > 0) {
      sections.push(
        `Copy these placeholders through unchanged, in the same order they appear: ${input.protectedTokens.join(', ')}. They stand for terms that must not be translated.`,
      );
    }
    if (input.glossary.length > 0 && input.targetLanguage === 'AR') {
      const pairs = input.glossary.map((entry) => `${entry.english} = ${entry.arabic}`);
      sections.push(`Use these renderings so terminology stays consistent: ${pairs.join('; ')}.`);
    }
    if (input.contextSummary !== undefined && input.contextSummary.trim().length > 0) {
      sections.push(`Surrounding narrative: ${input.contextSummary.trim()}`);
    }

    return sections.join('\n');
  }

  /**
   * Applies the mode's rules to text the model has already returned.
   *
   * The order is vocabulary first, mechanics second: a simplified word may be
   * shorter or longer than the one it replaced, so sentence-length enforcement
   * has to see the final wording.
   */
  localize(text: string, mode: TranslationMode, language: ContentLanguage): LocalizationResult {
    const profile = MODE_PROFILES[mode];
    const appliedRules: string[] = [];

    // Nothing in this pipeline is meaningful for a non-Arabic target: the
    // optimiser's rules are all about Arabic script and Arabic punctuation.
    if (language !== 'AR') {
      return { text: text.trim(), mode, appliedRules };
    }

    let current = text;
    if (profile.simplifiesVocabulary) {
      const simplified = applySimpleVocabulary(current);
      if (simplified !== current) appliedRules.push('SIMPLE_VOCABULARY');
      current = simplified;
    }

    const optimized = this.optimizer.optimize(current, {
      maxSentenceWords: profile.maxSentenceWords,
      stripConnectors: profile.stripConnectors,
      splitSentences: profile.splitSentences,
    });
    appliedRules.push(...optimized.changes);

    return { text: optimized.text, mode, appliedRules };
  }
}

export function applySimpleVocabulary(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SIMPLE_VOCABULARY) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}
