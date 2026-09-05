import {
  EMBEDDING_INPUT_CHARACTER_LIMIT,
  characterCount,
  clamp01,
  containsArabicScript,
  normalizeVector,
  round,
  tokenize,
} from '@trendhunter/shared';

import { hashString, hashStringWithSalt } from './deterministic';

/**
 * The text analysis the offline provider runs instead of calling a model.
 *
 * These are the three operations where a real implementation genuinely changes
 * how the rest of the platform behaves: summarisation feeds the topic cards,
 * classification feeds the relevance score, and the embeddings feed clustering
 * and semantic search. Returning plausible-looking noise here would make every
 * downstream feature untestable, so each one is a real (if small) algorithm.
 */

/** Sentence terminators in both scripts, including the Arabic question mark. */
const SENTENCE_BOUNDARY = /(?<=[.!?؟…])\s+|\n+/u;

/** Openers score a little higher: news writing front-loads the point. */
const LEAD_SENTENCE_BONUS = 0.35;

/** Sentences shorter than this are fragments — headers, bylines, "Read more". */
const MIN_SUMMARY_SENTENCE_TOKENS = 4;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Extractive summarisation by term frequency.
 *
 * Each sentence scores the sum of the document frequencies of the distinct
 * terms it contains, damped by its own length so a long sentence cannot win by
 * accumulation alone. The winners are re-emitted in source order, because a
 * summary whose sentences are reordered by score reads as a non-sequitur.
 */
export function extractiveSummary(text: string, maxSentences: number): string {
  const sentences = splitSentences(text);
  const wanted = Math.max(1, Math.floor(maxSentences));
  if (sentences.length <= wanted) return sentences.join(' ');

  const frequencies = new Map<string, number>();
  const perSentenceTokens = sentences.map((sentence) => {
    const tokens = tokenize(sentence);
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return tokens;
  });

  const scored = sentences.map((sentence, index) => {
    const tokens = perSentenceTokens[index] ?? [];
    const distinct = new Set(tokens);
    let total = 0;
    for (const token of distinct) total += frequencies.get(token) ?? 0;

    const lengthPenalty = Math.sqrt(Math.max(1, tokens.length));
    const positionBonus = index === 0 ? LEAD_SENTENCE_BONUS : 0;
    const fragmentPenalty = tokens.length < MIN_SUMMARY_SENTENCE_TOKENS ? 0.25 : 1;
    return { index, sentence, score: (total / lengthPenalty + positionBonus) * fragmentPenalty };
  });

  return (
    scored
      .slice()
      // Ties break on source order, so the result never depends on sort stability.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, wanted)
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.sentence)
      .join(' ')
  );
}

export interface LabelScore {
  readonly label: string;
  readonly confidence: number;
}

/** Occurrences at which the frequency term is considered saturated. */
const LABEL_FREQUENCY_REFERENCE = 4;

/** Share of the score that comes from coverage rather than repetition. */
const LABEL_COVERAGE_SHARE = 0.75;

/**
 * Scores candidate labels by keyword overlap with the text.
 *
 * Coverage — how much of the label's own vocabulary appears at all — dominates,
 * because a two-word label matched on both words is a far stronger signal than
 * one word repeated six times. Labels are scored independently rather than
 * normalised against each other: the relevance engine consumes the winning
 * confidence on its own scale, and a document really can be strongly about two
 * interests at once.
 */
export function scoreLabels(text: string, labels: readonly string[]): LabelScore[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);

  const scored: LabelScore[] = [];
  for (const label of labels) {
    const labelTokens = [...new Set(tokenize(label))];
    if (labelTokens.length === 0) continue;

    let matched = 0;
    let occurrences = 0;
    for (const token of labelTokens) {
      const count = counts.get(token) ?? matchByStem(counts, token);
      if (count > 0) {
        matched += 1;
        occurrences += count;
      }
    }
    if (matched === 0) continue;

    const coverage = matched / labelTokens.length;
    const frequency = clamp01(Math.log1p(occurrences) / Math.log1p(LABEL_FREQUENCY_REFERENCE));
    const confidence = coverage * (LABEL_COVERAGE_SHARE + (1 - LABEL_COVERAGE_SHARE) * frequency);
    scored.push({ label, confidence: round(clamp01(confidence), 4) });
  }

  return scored.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

/**
 * Falls back to a stem match so that "agent" in the label finds "agents" in the
 * text. Only prefixes of a meaningful length are considered, otherwise "AI"
 * would match "aim".
 */
const MIN_STEM_LENGTH = 4;

function matchByStem(counts: ReadonlyMap<string, number>, token: string): number {
  if (token.length < MIN_STEM_LENGTH) return 0;
  let total = 0;
  for (const [candidate, count] of counts) {
    if (candidate.startsWith(token) || token.startsWith(candidate.slice(0, MIN_STEM_LENGTH))) {
      if (candidate.length >= MIN_STEM_LENGTH) total += count;
    }
  }
  return total;
}

/** Weights of the three feature families hashed into the embedding. */
const FEATURE_WEIGHTS = {
  unigram: 1,
  bigram: 0.6,
  /** Shared prefixes let morphological variants ("embed", "embedding") overlap. */
  prefix: 0.35,
} as const;

const PREFIX_LENGTH = 4;

/**
 * Function words dropped before hashing.
 *
 * They appear in almost every document, so they push every pair of texts
 * towards each other and compress the gap between "related" and "unrelated" —
 * which is precisely the gap clustering thresholds are set against. Both
 * scripts are covered because a post mixing Arabic and English is the norm here.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'not',
  'but',
  'you',
  'they',
  'their',
  'them',
  'its',
  'his',
  'her',
  'our',
  'your',
  'all',
  'any',
  'can',
  'will',
  'would',
  'should',
  'could',
  'been',
  'into',
  'over',
  'more',
  'most',
  'than',
  'then',
  'there',
  'here',
  'what',
  'when',
  'which',
  'who',
  'how',
  'why',
  'about',
  'after',
  'before',
  'also',
  'just',
  'only',
  'out',
  'off',
  'per',
  'via',
  'get',
  'got',
  'one',
  'two',
  'new',
  'now',
  'it',
  'is',
  'in',
  'on',
  'at',
  'to',
  'of',
  'as',
  'by',
  'or',
  'be',
  'an',
  'we',
  'do',
  'so',
  'up',
  'if',
  'no',
  'في',
  'من',
  'على',
  'إلى',
  'عن',
  'مع',
  'هذا',
  'هذه',
  'ذلك',
  'التي',
  'الذي',
  'أن',
  'إن',
  'كان',
  'كانت',
  'لا',
  'ما',
  'لكن',
  'أو',
  'ثم',
  'قد',
  'كل',
  'بعض',
  'هو',
  'هي',
  'هم',
  'بين',
  'حول',
  'بعد',
  'قبل',
  'أكثر',
  'كما',
  'حتى',
  'لأن',
  'لذلك',
]);

/**
 * A deterministic sentence embedding built by feature hashing.
 *
 * Unigrams, adjacent bigrams and token prefixes are hashed into buckets with a
 * signed weight, then the vector is L2-normalised so that a dot product is a
 * cosine. It is not semantic — it cannot tell that "car" and "automobile" are
 * related — but it is *monotonic in lexical overlap*, which is the property
 * clustering and hybrid search are tested against: two texts about the same
 * topic score meaningfully higher than two unrelated ones, every time.
 *
 * The second, salted hash choosing the sign is what keeps that true: with
 * unsigned hashing every bucket collision pushes similarity up, and unrelated
 * texts slowly drift towards each other as the vocabulary grows.
 */
export function embedText(text: string, dimensions: number): number[] {
  const width = Math.max(1, Math.floor(dimensions));
  const vector = new Array<number>(width).fill(0);

  const tokens = tokenize(text.slice(0, EMBEDDING_INPUT_CHARACTER_LIMIT)).filter(
    (token) => !STOP_WORDS.has(token),
  );
  if (tokens.length === 0) return vector;

  const features = new Map<string, number>();
  const bump = (feature: string, weight: number): void => {
    features.set(feature, (features.get(feature) ?? 0) + weight);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    bump(`u:${token}`, FEATURE_WEIGHTS.unigram);
    if (token.length > PREFIX_LENGTH) {
      bump(`p:${token.slice(0, PREFIX_LENGTH)}`, FEATURE_WEIGHTS.prefix);
    }
    const next = tokens[index + 1];
    if (next !== undefined) bump(`b:${token}_${next}`, FEATURE_WEIGHTS.bigram);
  }

  for (const [feature, weight] of features) {
    const bucket = hashString(feature) % width;
    const sign = (hashStringWithSalt(feature, 0x5bf03635) & 1) === 0 ? 1 : -1;
    // Sublinear scaling: the twentieth mention of a word says little more than
    // the second, and without it one repeated term dominates the direction.
    // `log1p` keeps sub-unit weights (the prefix family) positive, so damping
    // can never flip a feature's sign and turn agreement into disagreement.
    vector[bucket] = (vector[bucket] ?? 0) + sign * Math.log1p(weight);
  }

  return normalizeVector(vector);
}

/** Roughly how many characters one token costs, per script. */
const CHARACTERS_PER_TOKEN = { latin: 4, arabic: 2.5 } as const;

/**
 * Token estimate for the usage table.
 *
 * Arabic is counted more expensively because byte-pair vocabularies are trained
 * mostly on English: the same sentence really does cost noticeably more tokens
 * in Arabic, and the cost dashboard would mislead if it pretended otherwise.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const divisor = containsArabicScript(text)
    ? CHARACTERS_PER_TOKEN.arabic
    : CHARACTERS_PER_TOKEN.latin;
  return Math.max(1, Math.ceil(characterCount(text) / divisor));
}
