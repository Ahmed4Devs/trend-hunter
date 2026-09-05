import { toLatinDigits } from '@trendhunter/shared';

/**
 * Post-processing for Arabic that came out of a language model.
 *
 * A model's Arabic is usually *correct* and rarely *good*. The recurring
 * defects are mechanical, which is exactly why they belong here rather than in
 * a prompt: presentation-form ligatures copied from a PDF-scraped source, no
 * space between an Arabic word and the English term glued to it, Latin commas
 * and question marks stranded in an RTL run, Arabic-Indic digits that then sort
 * and compare differently from every other number in the product, tatweel used
 * as decoration, forty-word sentences, and the small herd of connectors
 * ("من الجدير بالذكر أن…") that a literal translation drags in from the English
 * original.
 *
 * Every step is a pure string transform, so the whole pipeline is
 * deterministic and each defect has one test.
 *
 * What this file deliberately does *not* do is fold أ/إ/آ to ا or strip
 * harakat. That folding belongs to search indexing, where two spellings must
 * collide; doing it to display text would change what the reader sees.
 */

export const OPTIMIZATION_STEPS = [
  'PRESENTATION_FORMS',
  'TATWEEL',
  'LATIN_DIGITS',
  'ARABIC_PUNCTUATION',
  'LATIN_SPACING',
  'ROBOTIC_CONNECTORS',
  'SENTENCE_LENGTH',
  'WHITESPACE',
] as const;
export type OptimizationStep = (typeof OPTIMIZATION_STEPS)[number];

export interface ArabicOptimizationResult {
  readonly text: string;
  /** The steps that actually changed something; feeds the user-facing note. */
  readonly changes: readonly OptimizationStep[];
}

export interface ArabicOptimizationOptions {
  /** Sentences longer than this are split at a connector. */
  readonly maxSentenceWords?: number;
  readonly stripConnectors?: boolean;
  readonly splitSentences?: boolean;
}

/** A thumb-rule ceiling for a sentence that has to be read on a phone. */
export const X_SENTENCE_WORD_LIMIT = 14;

/** Prose can carry a longer clause before it stops being readable. */
export const PROSE_SENTENCE_WORD_LIMIT = 25;

/** How many times one sentence may be re-split before we accept it as-is. */
const MAX_SENTENCE_SPLITS = 4;

/**
 * Arabic letters and their diacritics — deliberately *not* including ، ؛ ؟ or
 * the Arabic-Indic digits, because the spacing rules must treat those as
 * punctuation and as numbers respectively.
 */
const ARABIC_LETTER_CLASS =
  '\\u0621-\\u065F\\u066E-\\u06D5\\u06E5-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFC';

/**
 * Characters that behave as a left-to-right run: Latin, digits, the handle and
 * hashtag sigils, and the private-use sentinels that stand in for masked spans.
 */
const LATIN_RUN_CLASS = 'A-Za-z0-9@#\\uE000\\uE001';

const ARABIC_LETTER = new RegExp(`[${ARABIC_LETTER_CLASS}]`, 'u');

const ARABIC_THEN_LATIN = new RegExp(`([${ARABIC_LETTER_CLASS}])([${LATIN_RUN_CLASS}])`, 'gu');
const LATIN_THEN_ARABIC = new RegExp(`([${LATIN_RUN_CLASS}])([${ARABIC_LETTER_CLASS}])`, 'gu');

/** Latin punctuation that has an Arabic counterpart inside an Arabic run. */
const ARABIC_PUNCTUATION_BY_LATIN: Readonly<Record<string, string>> = {
  ',': '،',
  ';': '؛',
  '?': '؟',
};

const LATIN_PUNCTUATION_IN_ARABIC = new RegExp(`([${ARABIC_LETTER_CLASS}])([ \\t]*)([,;?])`, 'gu');

/** A full stop, exclamation or question mark that really does end a sentence. */
const ARABIC_SENTENCE_END = new RegExp(
  `(?<=[${ARABIC_LETTER_CLASS}])([.!?])(?=[^\\s.!?)\\]"'،؛؟])`,
  'gu',
);

/**
 * Ligatures and contextual glyphs — `ﻻ`, `ﷲ`, `ﻛ` — folded back to the letters
 * they render. The upper bound stops one below U+FEFF so the zero-width
 * no-break space is left for the whitespace step to deal with.
 */
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-ﻼ]/gu;

/** Kashida. Purely decorative elongation; it breaks search and wastes budget. */
const TATWEEL = /ـ+/gu;

/** Arabic decimal separator and thousands separator. */
const ARABIC_DECIMAL_SEPARATOR = /٫/gu;
const ARABIC_THOUSANDS_SEPARATOR = /٬/gu;

const MASK_OPEN = '';
const MASK_CLOSE = '';

/**
 * Spans that must survive every rule in this file untouched: a URL's query
 * string is full of `?` and `,` that are not punctuation, and a code span means
 * what it says.
 */
const MASKABLE_SPAN = /https?:\/\/[^\s<>"')\]]+|`[^`\n]*`/gu;

const MASK_TOKEN = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'gu');

interface MaskedText {
  readonly text: string;
  readonly spans: readonly string[];
}

function maskSpans(text: string): MaskedText {
  const spans: string[] = [];
  MASKABLE_SPAN.lastIndex = 0;
  const masked = text.replace(MASKABLE_SPAN, (match) => {
    const token = `${MASK_OPEN}${String(spans.length)}${MASK_CLOSE}`;
    spans.push(match);
    return token;
  });
  return { text: masked, spans };
}

function unmaskSpans(text: string, spans: readonly string[]): string {
  MASK_TOKEN.lastIndex = 0;
  return text.replace(MASK_TOKEN, (match, index: string) => {
    const parsed = Number.parseInt(index, 10);
    return spans[parsed] ?? match;
  });
}

/** Folds Arabic presentation forms back to the letters they render. */
export function normalizePresentationForms(text: string): string {
  PRESENTATION_FORMS.lastIndex = 0;
  return text.replace(PRESENTATION_FORMS, (character) => character.normalize('NFKC'));
}

export function removeTatweel(text: string): string {
  return text.replace(TATWEEL, '');
}

/**
 * Latin digits everywhere, including in Arabic copy.
 *
 * Numbers in this product are compared, charted and sorted across locales; a
 * score written ٨٧ is a different string from 87 and silently stops matching.
 * The Arabic decimal and thousands separators go with them.
 */
export function normalizeDigits(text: string): string {
  return toLatinDigits(text)
    .replace(ARABIC_DECIMAL_SEPARATOR, '.')
    .replace(ARABIC_THOUSANDS_SEPARATOR, ',');
}

/**
 * Replaces Latin punctuation with its Arabic counterpart, but only when the
 * character before it is an Arabic letter. That single condition is what keeps
 * `1,000`, `v2.1?` and the query string of a link out of it.
 */
export function applyArabicPunctuation(text: string): string {
  LATIN_PUNCTUATION_IN_ARABIC.lastIndex = 0;
  return text.replace(
    LATIN_PUNCTUATION_IN_ARABIC,
    (match, letter: string, spacing: string, punctuation: string) => {
      const replacement = ARABIC_PUNCTUATION_BY_LATIN[punctuation];
      return replacement === undefined ? match : `${letter}${spacing}${replacement}`;
    },
  );
}

/**
 * Puts a space on both sides of every Latin run embedded in Arabic, and takes
 * away the spaces that do not belong before punctuation.
 *
 * `يستخدمAPI` is what a model produces when it splices a preserved term back
 * into an Arabic sentence, and it is unreadable — the shaping engine joins the
 * Arabic letters straight into the Latin glyphs.
 */
export function fixLatinSpacing(text: string): string {
  return (
    text
      .replace(ARABIC_THEN_LATIN, '$1 $2')
      .replace(LATIN_THEN_ARABIC, '$1 $2')
      // No space before closing punctuation…
      .replace(/[ \t]+([،؛؟!:.](?:\s|$))/gu, '$1')
      .replace(/[ \t]+([,;?])(?=\s|$)/gu, '$1')
      // …and exactly one after it, unless it ends the text or repeats.
      .replace(/([،؛؟])(?=[^\s،؛؟!?.])/gu, '$1 ')
      // Only after an Arabic letter: a full stop between two Latin characters
      // belongs to `Node.js` or a version number, not to a sentence.
      .replace(ARABIC_SENTENCE_END, '$1 ')
  );
}

interface ConnectorRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * The stock phrases a literal English→Arabic translation produces.
 *
 * Each one is grammatical and each one is dead weight: they are the Arabic
 * equivalents of "it is worth noting that", inserted because the model is
 * padding towards a formal register nobody uses on X. Removing them is the
 * single largest readability win available after the spacing fixes.
 */
const CONNECTOR_RULES: readonly ConnectorRule[] = [
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?من الجدير بالذكر أن(?:ه)?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?تجدر الإشارة إلى أن(?:ه)?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?من المهم أن نلاحظ أن(?:ه)?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?يمكن القول إن(?:ه)?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?في الواقع[،,]?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?بشكل أساسي[،,]?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?بشكل عام[،,]?\s*/gu, replacement: '' },
  { pattern: /(?:^|(?<=[.!؟\n]\s))و?في هذا السياق[،,]?\s*/gu, replacement: '' },
  { pattern: /علاوة على ذلك[،,]?/gu, replacement: 'كذلك،' },
  { pattern: /بالإضافة إلى ذلك[،,]?/gu, replacement: 'كذلك،' },
  { pattern: /على الرغم من ذلك[،,]?/gu, replacement: 'لكن' },
  { pattern: /على الرغم من أن/gu, replacement: 'رغم أن' },
  { pattern: /في نهاية المطاف/gu, replacement: 'في النهاية' },
  { pattern: /وذلك من أجل/gu, replacement: 'لـ' },
  { pattern: /من أجل أن/gu, replacement: 'كي' },
  { pattern: /القيام بـ/gu, replacement: '' },
];

export function stripRoboticConnectors(text: string): string {
  let result = text;
  for (const rule of CONNECTOR_RULES) {
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, rule.replacement);
  }
  // A removal at the head of a sentence can leave the comma that followed it.
  return result.replace(/(^|[.!؟\n]\s*)[،,؛]\s*/gu, '$1');
}

const SENTENCE_TERMINATORS = new Set(['.', '!', '?', '؟', '؛', '…', '۔']);
const SENTENCE_CLOSERS = new Set(['"', "'", ')', ']', '»', '”', '’']);

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

/**
 * Splits text into sentences, keeping each terminator with the sentence it
 * ends.
 *
 * This is the boundary set the thread splitter is allowed to cut on, so it errs
 * towards *not* finding a boundary: a decimal point, an ellipsis mid-clause or
 * a dot inside a URL must never produce one, because a thread post that starts
 * mid-thought is worse than one that runs long.
 */
export function splitSentences(text: string): string[] {
  const { text: masked, spans } = maskSpans(text);
  const sentences: string[] = [];
  let start = 0;

  const push = (raw: string): void => {
    const sentence = unmaskSpans(raw, spans).trim();
    if (sentence.length > 0) sentences.push(sentence);
  };

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index] ?? '';

    if (character === '\n') {
      push(masked.slice(start, index));
      start = index + 1;
      continue;
    }
    if (!SENTENCE_TERMINATORS.has(character)) continue;
    if (character === '.' && isDigit(masked[index - 1]) && isDigit(masked[index + 1])) continue;

    let end = index + 1;
    while (
      end < masked.length &&
      (SENTENCE_TERMINATORS.has(masked[end] ?? '') || SENTENCE_CLOSERS.has(masked[end] ?? ''))
    ) {
      end += 1;
    }

    const next = masked[end];
    if (next === undefined || /\s/u.test(next)) {
      push(masked.slice(start, end));
      start = end;
    }
    index = end - 1;
  }

  push(masked.slice(start));
  return sentences;
}

/**
 * Connectors a long Arabic sentence can be cut in front of.
 *
 * The new sentence keeps the connector, which is why the `و`-prefixed forms are
 * safe: "وهذا يعني…" is an ordinary way to open an Arabic sentence, whereas
 * dropping the prefix would change the relationship between the two halves.
 */
const SENTENCE_BREAK_CONNECTORS: readonly string[] = [
  'لكن',
  'لكنّ',
  'بينما',
  'حيث',
  'كما',
  'لأن',
  'ثم',
  'وهذا',
  'وهو',
  'وهي',
  'وقد',
  'ولكن',
  'ومع',
  'وفي',
  'وعندما',
];

function wordsOf(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word.length > 0);
}

/**
 * Cuts one sentence in front of the connector nearest its middle.
 *
 * Only the middle 40% is considered: a break two words in produces a stub, and
 * one two words from the end produces a dangling fragment. When no connector
 * sits there the sentence is left alone — a long sentence beats a mangled one.
 */
function splitOneSentence(sentence: string, maxWords: number): string[] {
  const words = wordsOf(sentence);
  if (words.length <= maxWords) return [sentence];

  const lowerBound = Math.floor(words.length * 0.3);
  const upperBound = Math.ceil(words.length * 0.7);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const middle = words.length / 2;

  for (let index = lowerBound; index < upperBound; index += 1) {
    const word = words[index];
    if (word === undefined) continue;
    const bare = word.replace(/^[("'«]+/u, '');
    if (!SENTENCE_BREAK_CONNECTORS.includes(bare)) continue;
    const distance = Math.abs(index - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex < 0) return [sentence];

  const head = words
    .slice(0, bestIndex)
    .join(' ')
    .replace(/[،؛,;]\s*$/u, '');
  const tail = words.slice(bestIndex).join(' ');
  if (head.length === 0 || tail.length === 0) return [sentence];
  return [/[.!؟…]$/u.test(head) ? head : `${head}.`, tail];
}

/** Splits every over-long sentence, then re-checks the halves. */
export function splitLongSentences(text: string, maxWords: number): string {
  let pending = splitSentences(text);
  for (let round = 0; round < MAX_SENTENCE_SPLITS; round += 1) {
    const next = pending.flatMap((sentence) => splitOneSentence(sentence, maxWords));
    if (next.length === pending.length) break;
    pending = next;
  }
  return pending.join(' ');
}

/** Collapses the whitespace an earlier step may have doubled up. */
export function normalizeArabicWhitespace(text: string): string {
  return text
    .replace(/\r\n/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]*\n[ \t]*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export class ArabicOptimizerService {
  private readonly defaults: Required<ArabicOptimizationOptions>;

  constructor(options: ArabicOptimizationOptions = {}) {
    this.defaults = {
      maxSentenceWords: options.maxSentenceWords ?? PROSE_SENTENCE_WORD_LIMIT,
      stripConnectors: options.stripConnectors ?? true,
      splitSentences: options.splitSentences ?? true,
    };
  }

  /**
   * Runs the pipeline and reports which steps bit.
   *
   * Order matters: masking comes first so URLs and code spans are inert for
   * everything after it; digits are normalised before punctuation so that a
   * converted `١,٥` is already `1,5` and therefore not mistaken for a clause
   * boundary; spacing runs after punctuation because punctuation substitution
   * changes what the spacing rules see.
   */
  optimize(text: string, options: ArabicOptimizationOptions = {}): ArabicOptimizationResult {
    const settings = { ...this.defaults, ...options };
    const changes: OptimizationStep[] = [];
    const { text: masked, spans } = maskSpans(text);
    let current = masked;

    const step = (name: OptimizationStep, transform: (value: string) => string): void => {
      const next = transform(current);
      if (next !== current) changes.push(name);
      current = next;
    };

    step('PRESENTATION_FORMS', normalizePresentationForms);
    step('TATWEEL', removeTatweel);
    step('LATIN_DIGITS', normalizeDigits);
    step('ARABIC_PUNCTUATION', applyArabicPunctuation);
    step('LATIN_SPACING', fixLatinSpacing);
    if (settings.stripConnectors) step('ROBOTIC_CONNECTORS', stripRoboticConnectors);
    if (settings.splitSentences) {
      step('SENTENCE_LENGTH', (value) => splitLongSentences(value, settings.maxSentenceWords));
    }
    step('WHITESPACE', normalizeArabicWhitespace);

    return { text: unmaskSpans(current, spans), changes };
  }

  /**
   * Short, punchy Arabic for an X post: connectors gone, sentences cut to
   * something a reader takes in at a glance.
   */
  optimizeForX(text: string): ArabicOptimizationResult {
    return this.optimize(text, {
      maxSentenceWords: X_SENTENCE_WORD_LIMIT,
      stripConnectors: true,
      splitSentences: true,
    });
  }

  /**
   * Longer-form Arabic. The mechanical fixes still apply — they are never
   * wrong — but the sentence budget is a paragraph's, not a post's.
   */
  optimizeForProse(text: string): ArabicOptimizationResult {
    return this.optimize(text, {
      maxSentenceWords: PROSE_SENTENCE_WORD_LIMIT,
      stripConnectors: false,
      splitSentences: true,
    });
  }

  /** Whether the text carries any Arabic letter at all. */
  containsArabicLetters(text: string): boolean {
    return ARABIC_LETTER.test(text);
  }
}
