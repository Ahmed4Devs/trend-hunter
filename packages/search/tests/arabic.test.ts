import { describe, expect, it } from 'vitest';

import { buildNormalizedSearchFields, normalizeArabicForSearch } from '../src/arabic';
import { detectQueryLanguage } from '../src/search-service';

/**
 * Arabic normalisation is only useful if it is symmetric: the same folding has
 * to be applied to the document when it is stored and to the query when it is
 * parsed. These tests pin both halves and the equivalences the folding creates.
 */

describe('normalizeArabicForSearch', () => {
  it('folds alef variants to a bare alef', () => {
    // The same word written with and without a hamza must produce one form,
    // or full-text search never connects the two.
    const variants = ['أحمد', 'احمد', 'إحمد', 'آحمد'];
    const normalized = variants.map(normalizeArabicForSearch);
    expect(new Set(normalized).size).toBe(1);
  });

  it('folds alef maqsura to ya', () => {
    expect(normalizeArabicForSearch('على')).toBe(normalizeArabicForSearch('علي'));
  });

  it('folds teh marbuta to heh', () => {
    expect(normalizeArabicForSearch('مقالة')).toBe(normalizeArabicForSearch('مقاله'));
  });

  it('strips diacritics', () => {
    // Tashkeel is optional in written Arabic, so a query is rarely vocalised
    // even when the source text is.
    expect(normalizeArabicForSearch('كِتَاب')).toBe(normalizeArabicForSearch('كتاب'));
  });

  it('strips tatweel', () => {
    expect(normalizeArabicForSearch('كــتــاب')).toBe(normalizeArabicForSearch('كتاب'));
  });

  it('converts Arabic-Indic digits to Latin digits', () => {
    expect(normalizeArabicForSearch('٢٠٢٦')).toBe('2026');
    expect(normalizeArabicForSearch('۲۰۲۶')).toBe('2026');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeArabicForSearch('  الذكاء    الاصطناعي  ')).toBe('الذكاء الاصطناعي');
  });

  it('leaves Latin text and preserved technical terms alone', () => {
    // Terminology preferences keep terms like API in Latin script; folding must
    // not corrupt them.
    expect(normalizeArabicForSearch('واجهة API للوكلاء')).toContain('API');
  });

  it('is idempotent', () => {
    const once = normalizeArabicForSearch('إطار عمل الوكلاء ٢٠٢٦');
    expect(normalizeArabicForSearch(once)).toBe(once);
  });

  it('handles empty input', () => {
    expect(normalizeArabicForSearch('')).toBe('');
    expect(normalizeArabicForSearch('   ')).toBe('');
  });
});

describe('buildNormalizedSearchFields', () => {
  it('produces normalised copies for Arabic rows', () => {
    const fields = buildNormalizedSearchFields('AR', {
      title: 'إطار عمل جديد',
      content: 'يوفر الإطار جدولة للمهام.',
    });
    expect(fields.normalizedTitle).toBeTruthy();
    expect(fields.normalizedContent).toBeTruthy();
    expect(fields.normalizedTitle).toBe(normalizeArabicForSearch('إطار عمل جديد'));
  });

  it('stores nothing for non-Arabic rows', () => {
    // The generated column falls back to the raw text for English, so a copy
    // would double the table for no benefit.
    for (const language of ['EN', 'OTHER']) {
      expect(buildNormalizedSearchFields(language, { title: 'A title', content: 'Body' })).toEqual({
        normalizedTitle: null,
        normalizedContent: null,
      });
    }
  });

  it('tolerates a missing title', () => {
    const fields = buildNormalizedSearchFields('AR', { title: null, content: 'نص' });
    expect(fields.normalizedTitle).toBeNull();
    expect(fields.normalizedContent).toBe('نص');
  });
});

describe('detectQueryLanguage', () => {
  it('routes an Arabic query to the Arabic configuration', () => {
    expect(detectQueryLanguage('الذكاء الاصطناعي والوكلاء')).toBe('AR');
  });

  it('routes an English query to the English configuration', () => {
    expect(detectQueryLanguage('openai agent framework')).toBe('EN');
  });

  it('routes mixed technical Arabic to Arabic', () => {
    // Arabic technical writing is heavily mixed with English terms; treating it
    // as English would index it under the wrong stemmer.
    expect(detectQueryLanguage('وكلاء الذكاء الاصطناعي باستخدام API')).toBe('AR');
  });

  it('defaults to English for a query with no script signal', () => {
    // English is the safe default: `simple` would disable stemming entirely.
    expect(detectQueryLanguage('12345')).toBe('EN');
  });
});
