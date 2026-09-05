import { describe, expect, it } from 'vitest';

import {
  containsArabicScript,
  detectLanguage,
  directionForLocale,
  isArabic,
  toLatinDigits,
} from '../src/language';

describe('detectLanguage', () => {
  it('classifies plain English prose', () => {
    const result = detectLanguage('The new model was released this morning.');
    expect(result.language).toBe('EN');
    expect(result.tag).toBe('en');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies plain Arabic prose', () => {
    const result = detectLanguage('تم إطلاق النموذج الجديد هذا الصباح');
    expect(result.language).toBe('AR');
    expect(result.tag).toBe('ar');
    expect(result.confidence).toBe(1);
  });

  it('classifies Arabic technical writing that keeps English terminology as Arabic', () => {
    const result = detectLanguage(
      'نستخدم نماذج اللغة الكبيرة LLM عبر واجهة API لتحليل البيانات في تطبيقات SaaS',
    );
    expect(result.language).toBe('AR');
    expect(result.tag).toBe('ar');
  });

  it('still says Arabic when English terms make up half the script characters', () => {
    // The Arabic threshold is deliberately far below the Latin one, because
    // Arabic technical prose is always peppered with untranslated acronyms.
    const result = detectLanguage('The new API for الذكاء الاصطناعي is here');
    expect(result.language).toBe('AR');
  });

  it('needs at least a few Arabic characters, not just one stray letter', () => {
    const result = detectLanguage('This is a long English sentence with the letter ب in it');
    expect(result.language).toBe('EN');
  });

  it('reports short strings as unknown rather than guessing', () => {
    for (const text of ['Hi', 'مرحبا', 'a b c', '']) {
      const result = detectLanguage(text);
      expect(result.language).toBe('OTHER');
      expect(result.tag).toBe('und');
      expect(result.confidence).toBe(0);
    }
  });

  it('reports symbol-only and digit-only input as unknown', () => {
    for (const text of ['!!! ??? ... ###', '1234567890', '     \t\n     ', '😀😀😀😀😀😀😀😀']) {
      expect(detectLanguage(text).language).toBe('OTHER');
    }
  });

  it('reports a script it does not model as unknown', () => {
    const result = detectLanguage('これは日本語の文章です');
    expect(result.language).toBe('OTHER');
    expect(result.tag).toBe('und');
  });

  it('reports a confidence inside the unit interval', () => {
    for (const text of ['Hello world here', 'مرحبا بالعالم كله', 'これは日本語の文章です', '']) {
      const { confidence } = detectLanguage(text);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('ignores digits and punctuation when computing the ratio', () => {
    expect(detectLanguage('English words 12345 !!!! ???').language).toBe('EN');
  });

  it('recognises the Arabic Presentation Forms block', () => {
    expect(detectLanguage('ﻣﺮﺣﺒﺎ ﺑﺎﻟﻌﺎﻟﻢ').language).toBe('AR');
  });

  it('is deterministic', () => {
    const text = 'الذكاء الاصطناعي وتطبيقات LLM';
    expect(detectLanguage(text)).toEqual(detectLanguage(text));
  });
});

describe('isArabic', () => {
  it('agrees with detectLanguage', () => {
    expect(isArabic('تم إطلاق النموذج الجديد')).toBe(true);
    expect(isArabic('The new model was released')).toBe(false);
    expect(isArabic('')).toBe(false);
  });
});

describe('containsArabicScript', () => {
  it('is true for a single Arabic character, unlike the classifier', () => {
    expect(containsArabicScript('hello ب')).toBe(true);
    expect(containsArabicScript('hello')).toBe(false);
    expect(containsArabicScript('')).toBe(false);
  });

  it('covers the supplement and presentation form blocks', () => {
    expect(containsArabicScript('ﻣ')).toBe(true);
    expect(containsArabicScript('ݐ')).toBe(true);
  });
});

describe('toLatinDigits', () => {
  it('converts the Arabic-Indic block', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts the Extended Arabic-Indic block', () => {
    expect(toLatinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts digits embedded in Arabic prose and leaves the letters alone', () => {
    expect(toLatinDigits('عدد المنشورات ٤٩٠٠ منشور')).toBe('عدد المنشورات 4900 منشور');
  });

  it('handles both blocks mixed in one string', () => {
    expect(toLatinDigits('٥ و ۷')).toBe('5 و 7');
  });

  it('leaves ASCII digits and non-digit text untouched', () => {
    expect(toLatinDigits('score 42 / 100')).toBe('score 42 / 100');
    expect(toLatinDigits('')).toBe('');
  });
});

describe('directionForLocale', () => {
  it('is rtl for every Arabic locale tag', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('ar-SA')).toBe('rtl');
    expect(directionForLocale('AR')).toBe('rtl');
  });

  it('is ltr for everything else', () => {
    expect(directionForLocale('en')).toBe('ltr');
    expect(directionForLocale('en-GB')).toBe('ltr');
    expect(directionForLocale('')).toBe('ltr');
  });
});
