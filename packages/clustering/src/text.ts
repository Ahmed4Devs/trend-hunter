import { tokenize } from '@trendhunter/shared';

/**
 * Lexical primitives behind the similarity engine.
 *
 * Clustering compares text that arrives from four different kinds of source in
 * two different scripts, so the comparison has to happen on a normalised form:
 * an English headline is compared on its content words and its capitalised
 * names, an Arabic one on its content words alone, because Arabic has no case
 * and would otherwise contribute no entity signal at all.
 *
 * Every Arabic letter the logic depends on is bound to a named constant. Inline
 * bidirectional characters reorder on display, so a regex or a slice offset
 * written with them is unreviewable; the stopword table below is the one
 * exception, because it is data a reviewer has to be able to read as Arabic.
 */

/**
 * English function words. They appear in every headline and therefore carry no
 * information about *which* event a headline is about — including them would
 * make "Thoughts about the new model" and "The new update is out" look related.
 */
export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  'about',
  'after',
  'again',
  'against',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'get',
  'got',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'like',
  'may',
  'me',
  'might',
  'more',
  'most',
  'much',
  'must',
  'my',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'one',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'out',
  'over',
  'own',
  'same',
  'shall',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'us',
  'very',
  'via',
  'vs',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
]);

/**
 * Arabic function words, written in the folded form produced by
 * {@link foldArabic}: the folding runs before the lookup, so the preposition
 * spelled with alef maqsura is matched through its yeh spelling and the hamzated
 * forms through their bare-alef spelling.
 */
export const ARABIC_STOPWORDS: ReadonlySet<string> = new Set([
  'الا',
  'الان',
  'التي',
  'الذي',
  'الذين',
  'الي',
  'اليوم',
  'ام',
  'اما',
  'ان',
  'انا',
  'انت',
  'او',
  'ايضا',
  'بعد',
  'به',
  'بها',
  'بين',
  'ثم',
  'حتي',
  'حول',
  'خلال',
  'ذلك',
  'سوف',
  'عن',
  'عند',
  'عندما',
  'علي',
  'غير',
  'في',
  'فيه',
  'قبل',
  'قد',
  'كان',
  'كانت',
  'كل',
  'كما',
  'لا',
  'لكن',
  'لم',
  'لن',
  'له',
  'لها',
  'ما',
  'ماذا',
  'مع',
  'من',
  'نحن',
  'نفس',
  'هذا',
  'هذه',
  'هل',
  'هم',
  'هنا',
  'هو',
  'هي',
  'يمكن',
]);

/**
 * Arabic marks that do not change a word's identity: the signs above/below a
 * letter, the harakat, the superscript alef, the Quranic annotation marks and
 * the tatweel elongation.
 */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/gu;

/** Alef with madda, hamza above, hamza below and wasla. */
const ALEF_VARIANTS = /[آأإٱ]/gu;
const ALEF = 'ا';
/** Alef maqsura, folded onto yeh. */
const ALEF_MAKSURA = /ى/gu;
const YEH = 'ي';
/** Teh marbuta, folded onto heh. */
const TEH_MARBUTA = /ة/gu;
const HEH = 'ه';
/** The definite article, "alef lam". */
const DEFINITE_ARTICLE = 'ال';

/**
 * Normalises Arabic orthography so that spellings a writer treats as
 * interchangeable compare as equal. This is the same folding the database
 * applies to `normalized_title`, so a token profile built here matches what the
 * search index holds.
 */
export function foldArabic(value: string): string {
  return value
    .normalize('NFC')
    .replace(ARABIC_MARKS, '')
    .replace(ALEF_VARIANTS, ALEF)
    .replace(ALEF_MAKSURA, YEH)
    .replace(TEH_MARBUTA, HEH);
}

/** Minimum length at which the Arabic definite article is worth stripping. */
const MIN_LENGTH_FOR_ARTICLE_STRIP = 5;

/**
 * Canonical comparison form of a single token: Arabic-folded, with the definite
 * article removed from long words so a noun compares equal whether or not the
 * writer made it definite. Short words keep their article, because stripping two
 * letters off a three-letter word leaves noise rather than a stem.
 */
export function normalizeToken(token: string): string {
  const folded = foldArabic(token);
  if (folded.length >= MIN_LENGTH_FOR_ARTICLE_STRIP && folded.startsWith(DEFINITE_ARTICLE)) {
    return folded.slice(DEFINITE_ARTICLE.length);
  }
  return folded;
}

export function isStopword(token: string): boolean {
  return ENGLISH_STOPWORDS.has(token) || ARABIC_STOPWORDS.has(token);
}

/** Only unhyphenated, digit-free Latin words are stemmed; `gpt-5` is a name. */
const PLAIN_LATIN_WORD = /^[a-z]+$/u;

/** Shortest stem the rules below may leave, which is what stops `news` → `new`. */
const MIN_STEM_LENGTH = 4;

/**
 * Suffix rules, most specific first. The rule that fires is the first one whose
 * stem is still long enough, so `hires` falls past `-es` (leaving `hir`) onto
 * `-s` and lands on `hire`.
 */
const SUFFIX_RULES: readonly (readonly [suffix: string, replacement: string])[] = [
  ['ies', 'y'],
  ['sses', 'ss'],
  ['ches', 'ch'],
  ['shes', 'sh'],
  ['xes', 'x'],
  ['ied', 'y'],
  ['ing', ''],
  ['ed', ''],
  ['es', ''],
  ['s', ''],
  ['e', ''],
];

/**
 * Light English suffix stripper.
 *
 * Four sources describe one event with four inflections of the same verb —
 * "releases", "released", "release" — and a set intersection that treats those
 * as three different words throws away the strongest lexical evidence there is.
 * It over-stems occasionally ("curious" becomes "curiou"), which costs nothing:
 * the rule is deterministic, so both sides of every comparison over-stem
 * identically, and a stem only has to be consistent, not a real word.
 */
export function stemLatin(token: string): string {
  if (!PLAIN_LATIN_WORD.test(token)) return token;
  for (const [suffix, replacement] of SUFFIX_RULES) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, token.length - suffix.length) + replacement;
    if (stem.length >= MIN_STEM_LENGTH) return stem;
  }
  return token;
}

/**
 * Content words of a text: lower-cased, script-normalised and stripped of
 * function words. Returned as a set because every consumer measures overlap.
 */
export function extractContentTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  // Folded before tokenising, not after: a diacritic is a mark rather than a
  // letter, so a tokeniser that splits on non-letters would tear a vocalised
  // Arabic word in half and leave two fragments that match nothing.
  for (const raw of tokenize(foldArabic(value))) {
    // Stopwords are matched before stemming: the table holds whole function
    // words, and `does` must not have to be listed as `doe` as well.
    const token = normalizeToken(raw);
    if (token.length < 2 || isStopword(token)) continue;
    tokens.add(stemLatin(token));
  }
  return tokens;
}

/** Splits on the same boundaries as `tokenize`, but preserves letter case. */
const CASED_TOKEN_BOUNDARY = /[^\p{L}\p{N}+#.\-_]+/u;
const TRIM_TOKEN_EDGES = /^[.\-_]+|[.\-_]+$/gu;

const HAS_UPPERCASE = /\p{Lu}/u;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\p{N}/u;

/**
 * Product names, organisations and versioned releases — the tokens that say
 * *which* thing a headline is about.
 *
 * The heuristic is capitalisation plus digits, which covers `OpenAI`, `GPT-5`,
 * `iPhone` and `Llama3` without a gazetteer. Sentence-initial capitals leak
 * through ("Thoughts about ..."), which is why the entity signal is blended with
 * containment rather than being a strict Jaccard, and why it is worth only a
 * fifth of the composite. Arabic contributes nothing here — it has no letter
 * case — so an Arabic post is judged on its embedding and content words, plus
 * whatever Latin product name the writer kept, which in practice is most of them.
 */
export function extractEntities(value: string): Set<string> {
  const entities = new Set<string>();
  for (const raw of foldArabic(value.normalize('NFKC')).split(CASED_TOKEN_BOUNDARY)) {
    const trimmed = raw.replace(TRIM_TOKEN_EDGES, '');
    if (trimmed.length < 2 || !HAS_LETTER.test(trimmed)) continue;
    if (!HAS_UPPERCASE.test(trimmed) && !HAS_DIGIT.test(trimmed)) continue;
    // Names are not stemmed: they are compared with each other, never with
    // running text, and a stemmed name is unreadable when the UI shows it.
    const normalized = normalizeToken(trimmed.toLowerCase());
    if (normalized.length < 2 || isStopword(normalized)) continue;
    entities.add(normalized);
  }
  return entities;
}

/** Size of the intersection of two sets, iterating the smaller one. */
export function intersectionSize(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) {
    if (large.has(value)) shared += 1;
  }
  return shared;
}

/** Jaccard index. Two empty sets agree about nothing, so the result is 0. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = intersectionSize(a, b);
  return shared / (a.size + b.size - shared);
}

/** Share of the smaller set contained in the larger one. */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return intersectionSize(a, b) / Math.min(a.size, b.size);
}

/** Share of `needles` present in `haystack`. */
export function coverage(needles: ReadonlySet<string>, haystack: ReadonlySet<string>): number {
  if (needles.size === 0 || haystack.size === 0) return 0;
  return intersectionSize(needles, haystack) / needles.size;
}
