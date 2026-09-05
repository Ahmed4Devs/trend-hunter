import { describe, expect, it } from 'vitest';

import {
  ArabicOptimizerService,
  applyArabicPunctuation,
  fixLatinSpacing,
  normalizeDigits,
  normalizePresentationForms,
  removeTatweel,
  splitLongSentences,
  splitSentences,
  stripRoboticConnectors,
} from '../src/arabic-optimizer-service';

const optimizer = new ArabicOptimizerService();

describe('normalizeDigits', () => {
  it('converts Arabic-Indic digits to Latin digits', () => {
    expect(normalizeDigits('لدينا ٨٧ نموذجًا و ١٢ فريقًا')).toBe('لدينا 87 نموذجًا و 12 فريقًا');
  });

  it('converts the extended Arabic-Indic digits too', () => {
    expect(normalizeDigits('۴۲')).toBe('42');
  });

  it('converts the Arabic decimal and thousands separators', () => {
    expect(normalizeDigits('٣٫٥')).toBe('3.5');
    expect(normalizeDigits('١٬٠٠٠')).toBe('1,000');
  });

  it('leaves Latin digits alone', () => {
    expect(normalizeDigits('87 models')).toBe('87 models');
  });
});

describe('normalizePresentationForms', () => {
  it('folds a ligature back to its letters', () => {
    expect(normalizePresentationForms('ﻻ')).toBe('لا');
  });

  it('leaves ordinary Arabic untouched', () => {
    expect(normalizePresentationForms('لا يوجد')).toBe('لا يوجد');
  });
});

describe('removeTatweel', () => {
  it('removes decorative elongation', () => {
    expect(removeTatweel('مرحبـــا')).toBe('مرحبا');
  });
});

describe('applyArabicPunctuation', () => {
  it('uses Arabic punctuation after Arabic letters', () => {
    expect(applyArabicPunctuation('مرحبا, كيف حالك?')).toBe('مرحبا، كيف حالك؟');
    expect(applyArabicPunctuation('أولا; ثانيا')).toBe('أولا؛ ثانيا');
  });

  it('never touches a number or a Latin run', () => {
    expect(applyArabicPunctuation('النتيجة 1,000 نقطة')).toBe('النتيجة 1,000 نقطة');
    expect(applyArabicPunctuation('Which one, exactly?')).toBe('Which one, exactly?');
  });
});

describe('fixLatinSpacing', () => {
  it('separates a Latin term glued to Arabic', () => {
    expect(fixLatinSpacing('يستخدمAPIجديد')).toBe('يستخدم API جديد');
  });

  it('does not put a space before Arabic punctuation', () => {
    expect(fixLatinSpacing('نستخدم API ، ثم نختبر')).toBe('نستخدم API، ثم نختبر');
  });

  it('leaves a dotted Latin identifier intact', () => {
    expect(fixLatinSpacing('نستخدم Node.js هنا')).toBe('نستخدم Node.js هنا');
  });
});

describe('stripRoboticConnectors', () => {
  it('removes the filler a literal translation produces', () => {
    const result = stripRoboticConnectors('من الجدير بالذكر أن النموذج أسرع.');
    expect(result).not.toContain('الجدير');
    expect(result).toContain('النموذج أسرع');
  });

  it('replaces heavy connectives with light ones', () => {
    expect(stripRoboticConnectors('علاوة على ذلك، النتائج جيدة.')).toContain('كذلك');
  });
});

describe('splitSentences', () => {
  it('splits on Arabic and Latin terminators', () => {
    expect(splitSentences('النموذج أسرع. هل جربته؟ نعم!')).toEqual([
      'النموذج أسرع.',
      'هل جربته؟',
      'نعم!',
    ]);
  });

  it('does not split inside a decimal number', () => {
    expect(splitSentences('النسخة 3.5 أسرع. جرّبها.')).toEqual(['النسخة 3.5 أسرع.', 'جرّبها.']);
  });

  it('does not split inside a link', () => {
    const sentences = splitSentences('اقرأ https://example.com/a.b ثم عد.');
    expect(sentences).toEqual(['اقرأ https://example.com/a.b ثم عد.']);
  });

  it('treats a line break as a boundary and drops empty segments', () => {
    expect(splitSentences('الأول\n\nالثاني')).toEqual(['الأول', 'الثاني']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('splitLongSentences', () => {
  const long =
    'هذا نموذج جديد يعمل على معالجة النصوص العربية بكفاءة عالية جدا لكن الفريق يحتاج إلى مزيد من الاختبارات قبل الإطلاق';

  it('cuts an over-long sentence at a connector', () => {
    const result = splitLongSentences(long, 14);
    expect(result).toContain('جدا. لكن');
  });

  it('leaves a sentence within budget alone', () => {
    expect(splitLongSentences(long, 25)).toBe(long);
  });

  it('leaves a long sentence with no usable connector alone', () => {
    const noConnector = 'كلمة '.repeat(20).trim();
    expect(splitLongSentences(noConnector, 5)).toBe(noConnector);
  });
});

describe('ArabicOptimizerService', () => {
  it('runs the whole pipeline and reports what it changed', () => {
    const result = optimizer.optimizeForX('يستخدمAPI في ٣ مشاريع, وهو سريع?');

    expect(result.text).toContain('API ');
    expect(result.text).toContain('3');
    expect(result.text).toContain('،');
    expect(result.text).toContain('؟');
    expect(result.changes).toContain('LATIN_DIGITS');
    expect(result.changes).toContain('LATIN_SPACING');
  });

  it('optimises an X post harder than prose', () => {
    const text =
      'من الجدير بالذكر أن هذا النموذج الجديد يعمل على معالجة النصوص العربية بكفاءة عالية جدا لكن الفريق يحتاج إلى اختبارات.';
    const forX = optimizer.optimizeForX(text);
    const forProse = optimizer.optimizeForProse(text);

    expect(forX.text).not.toContain('الجدير');
    expect(forProse.text).toContain('الجدير');
    expect(forX.text.length).toBeLessThan(forProse.text.length);
  });

  it('keeps a link exactly as written', () => {
    const url = 'https://example.com/docs?a=1,2&b=3';
    const result = optimizer.optimizeForX(`اقرأ التفاصيل على ${url} اليوم.`);
    expect(result.text).toContain(url);
  });

  it('reports no changes for text that is already clean', () => {
    const result = optimizer.optimizeForProse('النموذج أسرع بكثير.');
    expect(result.text).toBe('النموذج أسرع بكثير.');
    expect(result.changes).toEqual([]);
  });

  it('handles an empty string', () => {
    expect(optimizer.optimizeForX('').text).toBe('');
  });

  it('detects Arabic letters', () => {
    expect(optimizer.containsArabicLetters('API only')).toBe(false);
    expect(optimizer.containsArabicLetters('API فقط')).toBe(true);
  });
});
