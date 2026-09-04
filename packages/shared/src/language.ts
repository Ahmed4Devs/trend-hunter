import type { ContentLanguage } from '@trendhunter/types';

/**
 * Script-based language detection.
 *
 * The platform only has to answer one question — "is this English, Arabic, or
 * something else?" — so a script-ratio heuristic is both sufficient and far
 * more predictable than a statistical detector. It is deterministic, has no
 * model to download, works offline, and is trivially unit-testable, which
 * matters because the Arabic opportunity score is derived from these counts.
 */

/** Arabic, Arabic Supplement, Extended-A/B and the Arabic Presentation Forms. */
const ARABIC_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/u;

/** Basic Latin letters plus the Latin-1/Extended-A supplements. */
const LATIN_SCRIPT = /[A-Za-z\u00C0-\u024F]/u;

/** Arabic-Indic and Extended Arabic-Indic digits. */
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/gu;

const ARABIC_DIGIT_OFFSETS = [0x0660, 0x06f0] as const;

/**
 * Minimum share of script-bearing characters needed to call a text Arabic.
 * Kept low because Arabic technical writing is heavily mixed with English
 * terms (API, LLM, SaaS) that the terminology preferences deliberately keep.
 */
const ARABIC_THRESHOLD = 0.2;

/** Minimum share of Latin characters needed to call a text English. */
const LATIN_THRESHOLD = 0.5;

/** Texts shorter than this carry too little signal to classify confidently. */
const MIN_CONFIDENT_LENGTH = 8;

export interface LanguageDetection {
  readonly language: ContentLanguage;
  /** BCP-47 tag stored alongside the coarse enum: `ar`, `en` or `und`. */
  readonly tag: string;
  /** 0..1 share of script-bearing characters belonging to the winning script. */
  readonly confidence: number;
}

/**
 * Classifies text as Arabic, English or other by comparing script ratios.
 * Never throws; an empty or symbol-only string is reported as `OTHER`.
 */
export function detectLanguage(text: string): LanguageDetection {
  let arabic = 0;
  let latin = 0;
  let scripted = 0;

  for (const character of text) {
    if (ARABIC_SCRIPT.test(character)) {
      arabic += 1;
      scripted += 1;
    } else if (LATIN_SCRIPT.test(character)) {
      latin += 1;
      scripted += 1;
    }
  }

  if (scripted === 0 || text.trim().length < MIN_CONFIDENT_LENGTH) {
    return { language: 'OTHER', tag: 'und', confidence: 0 };
  }

  const arabicRatio = arabic / scripted;
  const latinRatio = latin / scripted;

  if (arabicRatio >= ARABIC_THRESHOLD && arabic >= 3) {
    return { language: 'AR', tag: 'ar', confidence: round3(arabicRatio) };
  }
  if (latinRatio >= LATIN_THRESHOLD) {
    return { language: 'EN', tag: 'en', confidence: round3(latinRatio) };
  }
  return { language: 'OTHER', tag: 'und', confidence: round3(Math.max(arabicRatio, latinRatio)) };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function isArabic(text: string): boolean {
  return detectLanguage(text).language === 'AR';
}

export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

/**
 * Converts Arabic-Indic digits to ASCII digits.
 *
 * Numbers in the UI are always rendered with Western digits — including in the
 * Arabic locale — so that charts, scores and counters stay comparable between
 * locales and are not mirrored by the RTL layout.
 */
export function toLatinDigits(value: string): string {
  return value.replace(ARABIC_INDIC_DIGITS, (digit) => {
    const codePoint = digit.codePointAt(0) ?? 0;
    for (const offset of ARABIC_DIGIT_OFFSETS) {
      if (codePoint >= offset && codePoint <= offset + 9) {
        return String(codePoint - offset);
      }
    }
    return digit;
  });
}

/** Text direction for a UI locale. */
export function directionForLocale(locale: string): 'rtl' | 'ltr' {
  return locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
}
