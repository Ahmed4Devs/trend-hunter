/**
 * Arabic normalisation for the search path.
 *
 * PostgreSQL's Snowball Arabic stemmer does not normalise orthographic variants
 * and ships with no stopword list, so `أحمد` and `احمد` — the same word, written
 * with and without the hamza — produce different lexemes and never match. The
 * fix is to fold the variants ourselves, on both sides.
 *
 * The rule that makes this work is SYMMETRY: the identical function is applied
 * to the document when the row is stored (`normalized_title` /
 * `normalized_content`, which the generated tsvector reads for Arabic rows) and
 * to the query before it is parsed. Applying it to one side only is worse than
 * applying it to neither.
 *
 * This is a deliberate, bounded fix for a known gap; it does not make Arabic
 * full-text search good. That is why search is hybrid: the vector arm has no
 * such blind spot, and RRF lets it carry the queries this cannot answer.
 */

/** Tashkeel (diacritics), superscript alef and tatweel. */
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/gu;

/** Alef variants: آ أ إ ٱ all fold to ا. */
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/gu;

/** Alef maqsura ى folds to ya ي. */
const ALEF_MAQSURA = /\u0649/gu;

/** Teh marbuta ة folds to heh ه. */
const TEH_MARBUTA = /\u0629/gu;

/** Arabic-Indic and extended Arabic-Indic digits. */
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/gu;

const ARABIC_DIGIT_BASES = [0x0660, 0x06f0] as const;

/**
 * Folds Arabic orthographic variants so that a document and a query written
 * differently still produce the same lexemes.
 */
export function normalizeArabicForSearch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(ALEF_VARIANTS, '\u0627')
    .replace(ALEF_MAQSURA, '\u064A')
    .replace(TEH_MARBUTA, '\u0647')
    .replace(ARABIC_INDIC_DIGITS, toLatinDigit)
    .replace(/\s+/gu, ' ')
    .trim();
}

function toLatinDigit(digit: string): string {
  const codePoint = digit.codePointAt(0) ?? 0;
  for (const base of ARABIC_DIGIT_BASES) {
    if (codePoint >= base && codePoint <= base + 9) return String(codePoint - base);
  }
  return digit;
}

/**
 * Normalised copies for the columns the Arabic tsvector reads.
 *
 * Returns `null` for non-Arabic content: the generated column falls back to the
 * raw text for English, and storing a redundant copy of every English post
 * would double the table for nothing.
 */
export function buildNormalizedSearchFields(
  language: string,
  fields: { title?: string | null; content: string },
): { normalizedTitle: string | null; normalizedContent: string | null } {
  if (language !== 'AR') return { normalizedTitle: null, normalizedContent: null };
  return {
    normalizedTitle:
      fields.title === null || fields.title === undefined
        ? null
        : normalizeArabicForSearch(fields.title),
    normalizedContent: normalizeArabicForSearch(fields.content),
  };
}
