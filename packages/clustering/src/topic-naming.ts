import { clamp01, normalizeWhitespace, round, slugify, truncate } from '@trendhunter/shared';
import type { SourceKind } from '@trendhunter/types';

import { SIMILARITY_TUNING, TOPIC_NAME_TUNING } from './weights';

/**
 * Topic naming.
 *
 * A topic is named after the strongest headline among its posts, cleaned of the
 * boilerplate each source wraps its titles in. The cleaning is deliberately
 * conservative: a topic name is what the user sees in every list, every report
 * and every generated draft, so a rule that occasionally mangles a real
 * headline is worse than one that occasionally leaves a "PSA:" in place.
 *
 * Arabic headlines carry no such boilerplate and, having no letter case, cannot
 * satisfy the attribution test either — so they pass through with nothing more
 * than whitespace tidying and a word-boundary truncation.
 */

/** What the naming heuristic needs from a post. `ClusterablePost` satisfies it. */
export interface TopicNameCandidate {
  readonly title: string | null;
  readonly content: string;
  readonly source: SourceKind;
  readonly publishedAt: Date;
  /** 0..1 authority weight of the source. */
  readonly sourceAuthorityWeight?: number | undefined;
  /** 0..100 normalised engagement. */
  readonly engagementScore?: number | undefined;
}

export interface DerivedTopicName {
  readonly name: string;
  readonly slug: string;
  /** The headline the name was derived from, before cleaning. */
  readonly headline: string;
  readonly source: SourceKind | null;
  /** 0..1 strength of the chosen headline under the selection heuristic. */
  readonly strength: number;
  /** True when no title was usable and the name came from body text. */
  readonly fromContent: boolean;
}

/** Rendered only when every candidate was empty, so a topic always has a name. */
export const UNNAMED_TOPIC_NAME = 'Untitled topic';

/** `[D]`, `[Discussion]`, `(OC)` — a bracketed tag, optionally followed by a colon. */
const BRACKETED_TAG = /^[[(][^\]),]{1,24}[\])]\s*[:–—|-]?\s*/u;

/** Hacker News submission prefixes. */
const HN_PREFIX = /^(?:show|ask|tell|launch)\s+hn\s*:\s*/iu;

/**
 * Editorial labels that describe the *kind* of post rather than its subject.
 * The list is closed on purpose: a generic "strip everything before the first
 * colon" rule would turn "OpenAI: the next model" into "the next model".
 */
const LABEL_PREFIX =
  /^(?:psa|oc|update|breaking|exclusive|opinion|analysis|discussion|question|help|news|video|guide|tutorial|megathread|meta|serious|announcement|editorial|review|interview|report|rant|advice)\s*:\s*/iu;

/** Trailing publisher attribution: " - The Verge", " | TechCrunch". */
const TRAILING_ATTRIBUTION = /\s+[|·•»–—-]\s+([^|·•»–—]{2,48})$/u;

/** Trailing format or year markers: " [Video]", " (2026)". */
const TRAILING_MARKER = /\s*[[(](?:video|photos?|images?|updated?|\d{4})[\])]\s*$/iu;

/** Quotation marks a source wrapped the whole headline in. */
const WRAPPING_QUOTES = /^["'“”«‘’]+|["'“”»‘’]+$/gu;

/** Separators and dangling punctuation left behind by the strips above. */
const TRAILING_PUNCTUATION = /[\s|·•–—:;,.-]+$/u;
const LEADING_PUNCTUATION = /^[\s|·•–—:;,.-]+/u;

/** Lower-case words allowed inside a publisher name: "The Verge", "Voice of America". */
const ATTRIBUTION_PARTICLES = new Set(['the', 'of', 'and', 'de', 'la', 'le', 'el', 'al', 'du']);

const LATIN_LETTER = /\p{Script=Latin}/u;
const LATIN_UPPERCASE_START = /^[\p{Lu}\p{N}]/u;

function words(value: string): string[] {
  return value.split(/\s+/u).filter((word) => word.length > 0);
}

/**
 * Whether a trailing fragment reads like a publisher credit rather than the end
 * of the headline. Requiring title case is what protects "OpenAI XYZ — what it
 * means for developers"; requiring Latin script is what protects Arabic
 * headlines, whose script has no case and could never pass this test.
 */
function looksLikeAttribution(tail: string): boolean {
  const parts = words(tail);
  if (parts.length === 0 || parts.length > TOPIC_NAME_TUNING.maxAttributionWords) return false;
  if (!LATIN_LETTER.test(tail)) return false;
  return parts.every(
    (part) => LATIN_UPPERCASE_START.test(part) || ATTRIBUTION_PARTICLES.has(part.toLowerCase()),
  );
}

/**
 * Removes the boilerplate a source wraps its headlines in, leaving the sentence
 * that actually describes the event. Idempotent, and never returns an empty
 * string for a non-empty input: if a strip would consume the whole headline the
 * previous form is kept.
 */
export function stripHeadlineBoilerplate(title: string): string {
  let value = normalizeWhitespace(title).replace(WRAPPING_QUOTES, '');

  for (let pass = 0; pass < TOPIC_NAME_TUNING.maxStripPasses; pass += 1) {
    const before = value;
    for (const pattern of [BRACKETED_TAG, HN_PREFIX, LABEL_PREFIX]) {
      const stripped = value.replace(pattern, '');
      if (stripped.trim().length > 0) value = stripped.trim();
    }
    if (value === before) break;
  }

  value = value.replace(TRAILING_MARKER, '').trim();

  for (let pass = 0; pass < TOPIC_NAME_TUNING.maxStripPasses; pass += 1) {
    const match = TRAILING_ATTRIBUTION.exec(value);
    const tail = match?.[1];
    if (!match || tail === undefined) break;
    const head = value.slice(0, value.length - match[0].length).trim();
    if (words(head).length < TOPIC_NAME_TUNING.minRetainedWords) break;
    if (head.length < TOPIC_NAME_TUNING.minUsefulLength) break;
    if (!looksLikeAttribution(tail)) break;
    value = head;
  }

  value = value.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '');
  const cleaned = normalizeWhitespace(value);
  return cleaned.length > 0 ? cleaned : normalizeWhitespace(title);
}

const URL_PATTERN = /https?:\/\/\S+/gu;
/** Sentence terminators, including the Arabic question mark. */
const SENTENCE_BOUNDARY = /[.!?\u061F\n]+/u;

/** Recovers a headline from body text, for sources whose posts have no title. */
function headlineFromContent(content: string): string {
  const body = normalizeWhitespace(content.replace(URL_PATTERN, ' '));
  if (body.length === 0) return '';
  const [first] = body.split(SENTENCE_BOUNDARY);
  const sentence = (first ?? '').trim();
  return sentence.length >= TOPIC_NAME_TUNING.minUsefulLength ? sentence : body;
}

const QUESTION_ENDINGS = /[?\u061F]\s*$/u;

/** 1 inside the readable band, falling off proportionally outside it. */
function lengthFit(length: number): number {
  if (length >= TOPIC_NAME_TUNING.idealMinLength && length <= TOPIC_NAME_TUNING.idealMaxLength) {
    return 1;
  }
  return length < TOPIC_NAME_TUNING.idealMinLength
    ? clamp01(length / TOPIC_NAME_TUNING.idealMinLength)
    : clamp01(TOPIC_NAME_TUNING.idealMaxLength / length);
}

interface ScoredHeadline {
  readonly candidate: TopicNameCandidate;
  readonly headline: string;
  readonly cleaned: string;
  readonly fromContent: boolean;
  readonly strength: number;
}

function scoreHeadline(candidate: TopicNameCandidate): ScoredHeadline | null {
  const title = candidate.title?.trim() ?? '';
  const fromContent = title.length === 0;
  const headline = fromContent ? headlineFromContent(candidate.content) : title;
  if (headline.length === 0) return null;

  const cleaned = stripHeadlineBoilerplate(headline);
  if (cleaned.length === 0) return null;

  const weights = TOPIC_NAME_TUNING.weights;
  const base =
    clamp01(candidate.sourceAuthorityWeight ?? 0) * weights.sourceAuthority +
    lengthFit(cleaned.length) * weights.lengthFit +
    clamp01((candidate.engagementScore ?? 0) / 100) * weights.engagement;

  const questionFactor = QUESTION_ENDINGS.test(cleaned) ? TOPIC_NAME_TUNING.questionPenalty : 1;
  const contentFactor = fromContent ? TOPIC_NAME_TUNING.contentFallbackPenalty : 1;

  return {
    candidate,
    headline,
    cleaned,
    fromContent,
    strength: clamp01(base * questionFactor * contentFactor),
  };
}

/**
 * Orders headlines strongest first. The three tie breaks after the strength are
 * what make the derived name independent of the order the posts were loaded in:
 * two runs over the same cluster must produce the same topic name, or every
 * re-run would rename half the topics.
 */
function compareHeadlines(a: ScoredHeadline, b: ScoredHeadline): number {
  const byStrength = b.strength - a.strength;
  if (Math.abs(byStrength) > Number.EPSILON) return byStrength;
  const byTime = a.candidate.publishedAt.getTime() - b.candidate.publishedAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.candidate.source !== b.candidate.source) {
    return a.candidate.source < b.candidate.source ? -1 : 1;
  }
  return a.cleaned < b.cleaned ? -1 : a.cleaned > b.cleaned ? 1 : 0;
}

export interface TopicNameOptions {
  readonly maxLength?: number;
}

/**
 * Derives a topic name and slug from the posts that formed the topic.
 *
 * The slug comes from `@trendhunter/shared`, which transliterates Latin text and
 * keeps other scripts as they are — an Arabic topic therefore gets an Arabic
 * slug rather than a transliteration nobody would recognise.
 */
export function deriveTopicName(
  candidates: readonly TopicNameCandidate[],
  options: TopicNameOptions = {},
): DerivedTopicName {
  const maxLength = options.maxLength ?? TOPIC_NAME_TUNING.maxLength;
  const scored = candidates
    .map(scoreHeadline)
    .filter((entry): entry is ScoredHeadline => entry !== null)
    .sort(compareHeadlines);

  const best = scored[0];
  if (!best) {
    return {
      name: UNNAMED_TOPIC_NAME,
      slug: slugify(UNNAMED_TOPIC_NAME),
      headline: '',
      source: null,
      strength: 0,
      fromContent: false,
    };
  }

  const name = truncate(best.cleaned, maxLength);
  return {
    name,
    slug: slugify(name, maxLength),
    headline: best.headline,
    source: best.candidate.source,
    strength: round(best.strength, SIMILARITY_TUNING.precision),
    fromContent: best.fromContent,
  };
}
