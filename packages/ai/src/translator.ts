import { DEFAULT_PRESERVED_TERMS } from '@trendhunter/shared';
import type { ContentLanguage, TerminologyPreference, TranslationMode } from '@trendhunter/types';

import type { Rng } from './deterministic';
import {
  ARABIC_TO_ENGLISH,
  DROPPED_ENGLISH_WORDS,
  ENGLISH_TO_ARABIC,
  MAX_PHRASE_WORDS,
  MODE_EXPLANATIONS,
  SIMPLE_ARABIC_FORMS,
  TRANSLATION_MODE_STYLES,
  type LexiconEntry,
  type ModeStyle,
  type PartOfSpeech,
} from './lexicon';

/**
 * The offline translation engine.
 *
 * It is a rule-based transfer system, not a model: the source is segmented,
 * looked up in the curated lexicon, and re-emitted with the three Arabic
 * constructions that matter most for readability — the definite article, the
 * idafa (possessive) chain and adjective-after-noun order. Everything it does
 * not recognise is passed through in Latin script, which is what a bilingual
 * technical writer does anyway with product names and acronyms.
 *
 * The point is not to compete with a hosted model. It is that the Translations
 * page, the terminology preferences and the mode selector are all genuinely
 * exercisable with no API key, and that the same input always produces the same
 * Arabic.
 */

export interface TranslationDraft {
  readonly text: string;
  /** Terms that survived in Latin script, in order of first appearance. */
  readonly preservedTerms: readonly string[];
  readonly explanation: string;
}

export interface TranslateTextOptions {
  readonly sourceLanguage: ContentLanguage;
  readonly targetLanguage: ContentLanguage;
  readonly mode: TranslationMode;
  readonly terminologyPreference: TerminologyPreference;
  readonly preserveTerms: readonly string[];
  readonly rng: Rng;
}

type TokenKind = PartOfSpeech | 'unknown' | 'preserved';

interface EmittedToken {
  text: string;
  kind: TokenKind;
  /** Whether the Arabic form already carries the definite article. */
  definite: boolean;
  /** Trailing punctuation lifted from the source chunk. */
  trailing: string;
}

interface SourceChunk {
  readonly word: string;
  readonly trailing: string;
}

/** An all-caps acronym has no accepted Arabic form, so it stays in Latin. */
const ACRONYM = /^[A-Z][A-Z/+.]{1,7}$/;

const SENTENCE_BOUNDARY = /(?<=[.!?؟])\s+|\n+/u;

/** Splits a chunk into its word core and the punctuation hanging off the end. */
const CHUNK_SHAPE = /^[^\p{L}\p{N}]*(.*?)([^\p{L}\p{N}]*)$/u;

export function translateText(text: string, options: TranslateTextOptions): TranslationDraft {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { text: '', preservedTerms: [], explanation: explanationFor(options, []) };
  }

  if (options.targetLanguage === options.sourceLanguage || options.targetLanguage === 'OTHER') {
    // Nothing to do, and inventing a change would be worse than doing nothing.
    return { text: trimmed, preservedTerms: [], explanation: explanationFor(options, []) };
  }

  if (options.targetLanguage === 'EN') {
    return {
      text: toEnglish(trimmed),
      preservedTerms: [],
      explanation: explanationFor(options, []),
    };
  }

  return toArabic(trimmed, options);
}

/* -------------------------------------------------------------------------- */
/* English → Arabic                                                            */
/* -------------------------------------------------------------------------- */

function toArabic(text: string, options: TranslateTextOptions): TranslationDraft {
  const style = TRANSLATION_MODE_STYLES[options.mode];
  const preserved = buildPreservedIndex(text, options);
  const keptTerms: string[] = [];

  const sentences = text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const rendered: string[] = [];
  for (const sentence of sentences) {
    const tokens = emitTokens(splitChunks(sentence), preserved, keptTerms);
    const ordered = style.repairWordOrder ? repairWordOrder(tokens) : tokens;
    const assembled = assemble(ordered, style);
    for (const piece of splitLongSentences(assembled, style.maxSentenceWords)) {
      rendered.push(piece);
    }
  }

  const joined = joinSentences(rendered, style, options.rng);
  return {
    text: joined,
    preservedTerms: keptTerms,
    explanation: explanationFor(options, keptTerms),
  };
}

/**
 * The terms that must stay in Latin script, keyed by their lower-cased form.
 *
 * `preserveTerms` from the request always wins; the terminology preference then
 * decides how much of the default technical vocabulary joins it.
 */
function buildPreservedIndex(
  text: string,
  options: TranslateTextOptions,
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  const add = (term: string): void => {
    const key = term.trim().toLowerCase();
    if (key.length > 0 && !index.has(key)) index.set(key, term.trim());
  };

  for (const term of options.preserveTerms) add(term);

  if (options.terminologyPreference === 'KEEP_COMMON_ENGLISH_TERMS') {
    for (const term of DEFAULT_PRESERVED_TERMS) add(term);
  } else if (options.terminologyPreference === 'ARABIC_WHEN_POSSIBLE') {
    for (const chunk of splitChunks(text)) {
      if (ACRONYM.test(chunk.word)) add(chunk.word);
    }
  }

  return index;
}

function splitChunks(sentence: string): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  for (const raw of sentence.split(/\s+/u)) {
    if (raw.length === 0) continue;
    const match = CHUNK_SHAPE.exec(raw);
    const word = match?.[1] ?? raw;
    const trailing = match?.[2] ?? '';
    if (word.length === 0) {
      // Standalone punctuation: attach it to whatever came before.
      const previous = chunks.at(-1);
      if (previous) chunks[chunks.length - 1] = { ...previous, trailing: previous.trailing + raw };
      continue;
    }
    chunks.push({ word, trailing });
  }
  return chunks;
}

function emitTokens(
  chunks: readonly SourceChunk[],
  preserved: ReadonlyMap<string, string>,
  keptTerms: string[],
): EmittedToken[] {
  const tokens: EmittedToken[] = [];
  const window = Math.max(MAX_PHRASE_WORDS, longestKey(preserved));
  let pendingDefinite = false;

  for (let index = 0; index < chunks.length; ) {
    const matched = matchLongest(chunks, index, window, preserved);
    if (!matched) {
      index += 1;
      continue;
    }

    const { length, token, dropped, definiteRequest, construct } = matched;
    const trailing = chunks[index + length - 1]?.trailing ?? '';

    if (definiteRequest) pendingDefinite = true;
    if (construct) applyConstructState(tokens);

    if (!dropped && token) {
      const shouldDefine = pendingDefinite && token.kind === 'noun';
      tokens.push({
        ...token,
        text: shouldDefine ? makeDefinite(token.text) : token.text,
        definite: token.definite || shouldDefine,
        trailing,
      });
      if (token.kind === 'preserved') keptTerms.push(token.text);
      pendingDefinite = false;
    } else if (trailing.length > 0) {
      const previous = tokens.at(-1);
      if (previous) previous.trailing += trailing;
    }

    index += length;
  }

  return tokens;
}

interface Match {
  readonly length: number;
  readonly token: EmittedToken | null;
  readonly dropped: boolean;
  /** The source said "the": the next noun becomes definite. */
  readonly definiteRequest: boolean;
  /** The source said "of": the previous noun heads an idafa chain. */
  readonly construct: boolean;
}

function matchLongest(
  chunks: readonly SourceChunk[],
  start: number,
  window: number,
  preserved: ReadonlyMap<string, string>,
): Match | null {
  const contextual = matchContextual(chunks, start);
  if (contextual) return contextual;

  const remaining = chunks.length - start;
  for (let length = Math.min(window, remaining); length >= 1; length -= 1) {
    const words = chunks.slice(start, start + length).map((chunk) => chunk.word);
    const key = words.join(' ').toLowerCase();

    const preservedTerm = preserved.get(key);
    if (preservedTerm !== undefined) {
      return {
        length,
        token: { text: preservedTerm, kind: 'preserved', definite: false, trailing: '' },
        dropped: false,
        definiteRequest: false,
        construct: false,
      };
    }

    const entry = ENGLISH_TO_ARABIC.get(key);
    if (entry) {
      return {
        length,
        token: { text: entry.arabic, kind: entry.pos, definite: isDefinite(entry.arabic), trailing: '' },
        dropped: false,
        definiteRequest: false,
        construct: false,
      };
    }
  }

  const first = chunks[start];
  if (!first) return null;
  const word = first.word.toLowerCase();

  if (word === 'the') {
    return { length: 1, token: null, dropped: true, definiteRequest: true, construct: false };
  }
  if (word === 'of') {
    return { length: 1, token: null, dropped: true, definiteRequest: false, construct: true };
  }
  if (DROPPED_ENGLISH_WORDS.has(word)) {
    return { length: 1, token: null, dropped: true, definiteRequest: false, construct: false };
  }

  const plural = lookupPlural(word);
  if (plural) {
    return {
      length: 1,
      token: { text: plural, kind: 'noun', definite: isDefinite(plural), trailing: '' },
      dropped: false,
      definiteRequest: false,
      construct: false,
    };
  }

  // An unknown word is a product name, a handle or a number: keep it verbatim.
  return {
    length: 1,
    token: { text: first.word, kind: 'unknown', definite: false, trailing: '' },
    dropped: false,
    definiteRequest: false,
    construct: false,
  };
}

/**
 * The handful of words whose Arabic form depends on what follows them.
 *
 * "by" is the one that matters in this corpus: `reduced by 40 percent` is
 * `بنسبة`, while `built by the team` is `من قبل`. Getting it from the lexicon
 * alone would render every percentage as an agent.
 */
function matchContextual(chunks: readonly SourceChunk[], start: number): Match | null {
  const word = chunks[start]?.word.toLowerCase();
  const following = chunks[start + 1]?.word;
  if (word !== 'by' || following === undefined || !/^\d/u.test(following)) return null;

  return {
    length: 1,
    token: { text: 'بنسبة', kind: 'preposition', definite: false, trailing: '' },
    dropped: false,
    definiteRequest: false,
    construct: false,
  };
}

/** Resolves an English plural onto the Arabic plural of its singular. */
function lookupPlural(word: string): string | null {
  const candidates: string[] = [];
  if (word.endsWith('ies') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es') && word.length > 3) candidates.push(word.slice(0, -2));
  if (word.endsWith('s') && word.length > 2) candidates.push(word.slice(0, -1));

  for (const candidate of candidates) {
    const entry: LexiconEntry | undefined = ENGLISH_TO_ARABIC.get(candidate);
    if (entry?.pos === 'noun') return entry.plural ?? entry.arabic;
  }
  return null;
}

/**
 * Applies the idafa rule to the head of a possessive chain.
 *
 * "the future of AI" is `مستقبل الذكاء الاصطناعي`, not `المستقبل الذكاء
 * الاصطناعي`: the first noun loses its article. Getting this wrong is the
 * single most obvious tell of machine-translated Arabic.
 */
function applyConstructState(tokens: EmittedToken[]): void {
  const previous = tokens.at(-1);
  if (previous?.kind !== 'noun' || !previous.definite) return;
  previous.text = stripDefinite(previous.text);
  previous.definite = false;
}

function isDefinite(arabic: string): boolean {
  return arabic.startsWith('ال');
}

/**
 * Adds the definite article.
 *
 * Only single-word renderings are touched. A multi-word entry is already
 * written in the form the lexicon intends, and articles inside Arabic compounds
 * attach to different words depending on whether the compound is an idafa or a
 * noun-adjective pair — guessing there produces wrong Arabic, so it is left
 * alone.
 */
function makeDefinite(arabic: string): string {
  if (arabic.includes(' ') || isDefinite(arabic)) return arabic;
  return `ال${arabic}`;
}

function stripDefinite(arabic: string): string {
  if (arabic.includes(' ') || !isDefinite(arabic) || arabic.length <= 4) return arabic;
  return arabic.slice(2);
}

/**
 * Moves adjectives after the noun they qualify and makes them agree in
 * definiteness — `new model` becomes `نموذج جديد`, `the new model` becomes
 * `النموذج الجديد`.
 */
function repairWordOrder(tokens: readonly EmittedToken[]): EmittedToken[] {
  const result: EmittedToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (!current) continue;

    if (current.kind === 'adjective' && next !== undefined && isNounLike(next) && !current.text.includes(' ')) {
      const adjective: EmittedToken = {
        ...current,
        text: next.definite ? makeDefinite(current.text) : current.text,
        trailing: next.trailing,
      };
      result.push({ ...next, trailing: current.trailing });
      result.push(adjective);
      index += 1;
      continue;
    }

    result.push({ ...current });
  }
  return result;
}

/**
 * Heads that an adjective follows in Arabic.
 *
 * A preserved term and an unrecognised word are both nouns as far as the
 * sentence is concerned — `new API` has to become `API جديد`, not `جديد API`,
 * and leaving preserved terms out of this rule was the most visible artefact of
 * the earlier pass.
 */
function isNounLike(token: EmittedToken): boolean {
  return token.kind === 'noun' || token.kind === 'preserved' || token.kind === 'unknown';
}

function assemble(tokens: readonly EmittedToken[], style: ModeStyle): string {
  const words = tokens.map((token) => {
    const text = style.plainVocabulary ? simplify(token.text) : token.text;
    return `${text}${arabicPunctuation(token.trailing)}`;
  });
  return words.join(' ').replace(/\s+/gu, ' ').trim();
}

function simplify(text: string): string {
  return SIMPLE_ARABIC_FORMS[text] ?? text;
}

/** Latin punctuation is swapped for its Arabic counterpart where one exists. */
function arabicPunctuation(trailing: string): string {
  return trailing.replace(/,/gu, '،').replace(/\?/gu, '؟').replace(/;/gu, '؛');
}

/**
 * Breaks a long sentence into shorter ones, preferring a connector as the cut
 * point. This is what gives `X_STYLE` its stacked, punchy rhythm instead of one
 * unreadable line.
 */
function splitLongSentences(sentence: string, maxWords: number): string[] {
  if (maxWords <= 0) return sentence.length > 0 ? [sentence] : [];

  const words = sentence.split(' ').filter((word) => word.length > 0);
  if (words.length <= maxWords) return words.length > 0 ? [sentence] : [];

  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < words.length) {
    const end = Math.min(cursor + maxWords, words.length);
    let cut = end;
    if (end < words.length) {
      for (let index = end - 1; index > cursor + 2; index -= 1) {
        if (CUT_POINTS.has(words[index] ?? '')) {
          cut = index;
          break;
        }
      }
    }
    const piece = words.slice(cursor, cut).join(' ').trim();
    if (piece.length > 0) pieces.push(piece);
    cursor = cut;
  }
  return pieces;
}

/** Connectors that make a natural sentence break in Arabic. */
const CUT_POINTS: ReadonlySet<string> = new Set(['و', 'لكن', 'لأن', 'لذلك', 'ثم', 'بينما', 'كما']);

function joinSentences(sentences: readonly string[], style: ModeStyle, rng: Rng): string {
  const cleaned = sentences.map(closeSentence).filter((sentence) => sentence.length > 0);
  if (cleaned.length === 0) return '';

  const decorated = cleaned.map((sentence, index) => {
    if (index === 0 || style.connectors.length === 0) return sentence;
    // Only every other sentence takes a connector: one on each would read like
    // a template, which is exactly the impression this is meant to avoid.
    if (index % 2 === 0) return sentence;
    // A sentence that already opens on "لكن" or "ثم" does not want a second
    // connector bolted in front of it.
    if (startsWithConnector(sentence)) return sentence;
    const connector = style.connectors[rng.int(style.connectors.length)];
    return connector === undefined ? sentence : `${connector} ${sentence}`;
  });

  const opener = style.openers.length > 0 ? style.openers[rng.int(style.openers.length)] : undefined;
  const body = decorated.join(style.sentenceSeparator);
  return attachConjunction(opener === undefined ? body : `${opener}${style.sentenceSeparator}${body}`);
}

const SENTENCE_INITIAL_CONNECTORS: ReadonlySet<string> = new Set([
  'لكن',
  'ثم',
  'كما',
  'لذلك',
  'أيضاً',
  'بينما',
  'لأن',
  'و',
]);

function startsWithConnector(sentence: string): boolean {
  const [first] = sentence.split(' ');
  return first !== undefined && SENTENCE_INITIAL_CONNECTORS.has(first.replace(/[،:]$/u, ''));
}

/**
 * Arabic writes the conjunction as a prefix, not a separate word: `و مطوّرون`
 * is as wrong as writing "and developers" as "an d evelopers". It is fixed once
 * at the end so the sentence splitter can still see `و` as a break point.
 */
function attachConjunction(text: string): string {
  return text.replace(/(^|\s)و\s+/gu, '$1و');
}

function closeSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return '';
  return /[.!?؟،:]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

/* -------------------------------------------------------------------------- */
/* Arabic → English                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The reverse direction, used when an Arabic post is read in the English UI.
 *
 * Arabic morphology is written with clitics — the article and the conjunction
 * attach to the word — so a lookup miss is retried against the bare stem before
 * the word is passed through untouched.
 */
function toEnglish(text: string): string {
  const sentences = text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const rendered = sentences.map((sentence) => {
    const words = splitChunks(sentence).map((chunk) => {
      const english = lookupArabic(chunk.word);
      return `${english ?? chunk.word}${chunk.trailing.replace(/،/gu, ',').replace(/؟/gu, '?')}`;
    });
    const joined = words.join(' ').replace(/\s+/gu, ' ').trim();
    return joined.length > 0 ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}` : '';
  });

  return rendered.filter((sentence) => sentence.length > 0).join(' ');
}

/**
 * Short vowel marks and the superscript alif. Written Arabic omits them most of
 * the time, so they are stripped before a lookup rather than being carried into
 * the lexicon as a second spelling of every word. The range stops short of
 * U+0660, where the Arabic-Indic digits begin.
 */
const ARABIC_DIACRITICS = /[ً-ٰٟ]/gu;

function lookupArabic(word: string): string | undefined {
  const plain = word.replace(ARABIC_DIACRITICS, '');
  const hadConjunction = plain.startsWith('و') && plain.length > 3;
  const stem = hadConjunction ? plain.slice(1) : plain;

  const hit = lookupArabicStem(stem);
  if (hit === undefined) return undefined;
  return hadConjunction ? `and ${hit}` : hit;
}

/**
 * Tries the surface form, then the bare stem.
 *
 * Arabic writes the article as a prefix and marks the accusative with a
 * trailing alif, so `نموذجاً` and `النموذج` are both the dictionary's `نموذج`.
 * Without this the reverse direction misses almost every inflected noun.
 */
function lookupArabicStem(stem: string): string | undefined {
  const candidates = [stem];
  if (stem.startsWith('ال') && stem.length > 4) candidates.push(stem.slice(2));
  else candidates.push(`ال${stem}`);
  if (stem.endsWith('ا') && stem.length > 3) {
    const shortened = stem.slice(0, -1);
    candidates.push(shortened, `ال${shortened}`);
  }

  for (const candidate of candidates) {
    const hit = ARABIC_TO_ENGLISH.get(candidate);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */

function explanationFor(options: TranslateTextOptions, keptTerms: readonly string[]): string {
  const inArabic = options.targetLanguage === 'AR';
  const note = MODE_EXPLANATIONS[options.mode];
  const unique = [...new Set(keptTerms)];

  if (unique.length === 0) {
    return inArabic
      ? `${note.ar} لم تُترك أي مصطلحات بالإنجليزية.`
      : `${note.en} No terms were kept in the source language.`;
  }

  const shown = unique.slice(0, 6).join('، ');
  return inArabic
    ? `${note.ar} المصطلحات المحفوظة بالإنجليزية: ${shown}.`
    : `${note.en} Terms kept in English: ${unique.slice(0, 6).join(', ')}.`;
}

function longestKey(index: ReadonlyMap<string, string>): number {
  let longest = 1;
  for (const key of index.keys()) longest = Math.max(longest, key.split(' ').length);
  return longest;
}
