import { describe, expect, it } from 'vitest';

import { applySimpleVocabulary, LocalizationService } from '../src/localization-service';

const localization = new LocalizationService();

/** One long, formal, connector-laden sentence — the shape every mode disagrees about. */
const FORMAL_ARABIC =
  'من الجدير بالذكر أن هذا النموذج الجديد يتوجب عليه معالجة النصوص العربية بكفاءة عالية جدا لكن الفريق يحتاج إلى مزيد من الاختبارات.';

describe('LocalizationService.profileFor', () => {
  it('gives X_STYLE the shortest sentences and the lowest formality', () => {
    const x = localization.profileFor('X_STYLE');
    const professional = localization.profileFor('PROFESSIONAL');

    expect(x.formality).toBe('LOW');
    expect(professional.formality).toBe('HIGH');
    expect(x.maxSentenceWords).toBeLessThan(professional.maxSentenceWords);
  });

  it('lets LITERAL restructure nothing', () => {
    const literal = localization.profileFor('LITERAL');
    expect(literal.splitSentences).toBe(false);
    expect(literal.stripConnectors).toBe(false);
    expect(literal.allowsIdiom).toBe(false);
  });

  it('describes every mode differently', () => {
    const descriptions = (
      ['LITERAL', 'NATURAL', 'X_STYLE', 'PROFESSIONAL', 'SIMPLE_ARABIC'] as const
    ).map((mode) => localization.describe(mode));
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

describe('LocalizationService.localize', () => {
  it('leaves the structure alone in LITERAL mode', () => {
    const result = localization.localize(FORMAL_ARABIC, 'LITERAL', 'AR');
    expect(result.text).toContain('من الجدير بالذكر');
    expect(result.text).not.toContain('جدا. لكن');
  });

  it('strips the filler and shortens sentences in X_STYLE', () => {
    const result = localization.localize(FORMAL_ARABIC, 'X_STYLE', 'AR');
    expect(result.text).not.toContain('الجدير');
    expect(result.text).toContain('جدا. لكن');
    expect(result.appliedRules).toContain('ROBOTIC_CONNECTORS');
  });

  it('keeps the formal connectives in PROFESSIONAL', () => {
    const result = localization.localize(FORMAL_ARABIC, 'PROFESSIONAL', 'AR');
    expect(result.text).toContain('الجدير');
  });

  it('simplifies the vocabulary in SIMPLE_ARABIC', () => {
    const result = localization.localize(FORMAL_ARABIC, 'SIMPLE_ARABIC', 'AR');
    expect(result.text).toContain('يجب');
    expect(result.text).not.toContain('يتوجب');
    expect(result.appliedRules).toContain('SIMPLE_VOCABULARY');
  });

  it('produces a different result for every mode', () => {
    const outputs = (
      ['LITERAL', 'NATURAL', 'X_STYLE', 'PROFESSIONAL', 'SIMPLE_ARABIC'] as const
    ).map((mode) => localization.localize(FORMAL_ARABIC, mode, 'AR').text);
    expect(new Set(outputs).size).toBeGreaterThan(3);
  });

  it('does nothing but trim when the target is not Arabic', () => {
    const result = localization.localize('  The model is faster.  ', 'X_STYLE', 'EN');
    expect(result.text).toBe('The model is faster.');
    expect(result.appliedRules).toEqual([]);
  });
});

describe('LocalizationService.buildGuidance', () => {
  it('carries the directives, the placeholders, the glossary and the context', () => {
    const guidance = localization.buildGuidance({
      mode: 'X_STYLE',
      targetLanguage: 'AR',
      protectedTokens: ['[[TH0]]'],
      glossary: [{ english: 'API', arabic: 'واجهة برمجة التطبيقات' }],
      contextSummary: 'A seven post thread about agents.',
    });

    expect(guidance).toContain('Mode: X style');
    expect(guidance).toContain('[[TH0]]');
    expect(guidance).toContain('واجهة برمجة التطبيقات');
    expect(guidance).toContain('A seven post thread about agents.');
  });

  it('omits the sections that have nothing to say', () => {
    const guidance = localization.buildGuidance({
      mode: 'LITERAL',
      targetLanguage: 'EN',
      protectedTokens: [],
      glossary: [],
    });

    expect(guidance).not.toContain('placeholders');
    expect(guidance).not.toContain('Surrounding narrative');
  });
});

describe('applySimpleVocabulary', () => {
  it('swaps formal constructions for everyday ones', () => {
    expect(applySimpleVocabulary('إلا أنه لا يزال بطيئا')).toBe('لكن ما زال بطيئا');
  });

  it('leaves text with no formal vocabulary unchanged', () => {
    expect(applySimpleVocabulary('النموذج سريع')).toBe('النموذج سريع');
  });
});
