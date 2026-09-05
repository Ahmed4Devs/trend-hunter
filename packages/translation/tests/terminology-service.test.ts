import { describe, expect, it } from 'vitest';

import { TerminologyService, containsTerm, termPlaceholder } from '../src/terminology-service';

const service = new TerminologyService();

describe('TerminologyService.detectTerms', () => {
  it('finds acronyms, product names, backticked code and links', () => {
    const detected = service.detectTerms(
      'The GraphQL API of TrendHunter is documented at https://example.com/docs and uses `user_id`.',
    );
    const byTerm = new Map(detected.map((entry) => [entry.term, entry.kind]));

    expect(byTerm.get('API')).toBe('ACRONYM');
    // On the platform's keep-list, but classified by shape, not by membership.
    expect(byTerm.get('GraphQL')).toBe('PRODUCT_NAME');
    expect(byTerm.get('TrendHunter')).toBe('PRODUCT_NAME');
    expect(byTerm.get('user_id')).toBe('CODE_IDENTIFIER');
    expect(byTerm.get('https://example.com/docs')).toBe('CODE_IDENTIFIER');
  });

  it('ignores abbreviations that only look like identifiers', () => {
    const terms = service.detectTerms('Use a queue, e.g. for retries.').map((entry) => entry.term);
    expect(terms).not.toContain('e.g');
  });

  it('returns nothing for text with no technical vocabulary', () => {
    expect(service.detectTerms('')).toEqual([]);
    expect(service.detectTerms('نتحدث اليوم عن الطقس فقط.')).toEqual([]);
  });
});

describe('TerminologyService.resolvePreservedTerms', () => {
  const text = 'The API and the LLM run on Kubernetes; the Backend exposes `health_check`.';

  it('keeps the common English vocabulary by default', () => {
    const terms = service.resolvePreservedTerms(text, 'KEEP_COMMON_ENGLISH_TERMS');
    expect(terms).toContain('API');
    expect(terms).toContain('LLM');
    expect(terms).toContain('Kubernetes');
    expect(terms).toContain('Backend');
    expect(terms).toContain('health_check');
  });

  it('drops the terms that have an accepted Arabic rendering', () => {
    const terms = service.resolvePreservedTerms(text, 'ARABIC_WHEN_POSSIBLE');
    // Both have curated Arabic renderings, so they are translated…
    expect(terms).not.toContain('API');
    expect(terms).not.toContain('Backend');
    // …while an acronym with no accepted Arabic form stays in English.
    expect(terms).toContain('LLM');
  });

  it('keeps only proper nouns and code identifiers under FULL_ARABIC', () => {
    const terms = service.resolvePreservedTerms(text, 'FULL_ARABIC');
    expect(terms).toEqual(expect.arrayContaining(['Kubernetes', 'health_check']));
    expect(terms).not.toContain('API');
    expect(terms).not.toContain('LLM');
  });

  it('only reports terms that actually occur in the text', () => {
    const terms = service.resolvePreservedTerms(
      'A post about API design.',
      'KEEP_COMMON_ENGLISH_TERMS',
    );
    expect(terms).toContain('API');
    expect(terms).not.toContain('Kubernetes');
  });
});

describe('TerminologyService glossary', () => {
  it('offers one curated Arabic rendering per term', () => {
    expect(service.arabicFor('API')).toBe('واجهة برمجة التطبيقات');
    expect(service.arabicFor('api')).toBe('واجهة برمجة التطبيقات');
    expect(service.hasAcceptedArabic('LLM')).toBe(false);
  });

  it('narrows the glossary to the terms in a text', () => {
    const entries = service.glossaryFor('Our backend team ships fast.');
    expect(entries.map((entry) => entry.english)).toEqual(['Backend']);
  });
});

describe('TerminologyService.protectTerms', () => {
  it('masks terms and restores them verbatim', () => {
    const text = 'The API returns a Token.';
    const terms = service.resolvePreservedTerms(text, 'KEEP_COMMON_ENGLISH_TERMS');
    const protectedText = service.protectTerms(text, terms);

    expect(protectedText.text).not.toContain('API');
    expect(protectedText.text).toContain(termPlaceholder(0));

    const restored = service.restoreTerms(protectedText.text, protectedText.placeholders);
    expect(restored.text).toContain('API');
    expect(restored.text).toContain('Token');
    expect(restored.droppedTerms).toEqual([]);
  });

  it('prefers the longest term when two overlap', () => {
    const local = new TerminologyService({ additionalPreservedTerms: ['Database'] });
    const protectedText = local.protectTerms('We moved to a Vector Database last week.', [
      'Database',
      'Vector Database',
    ]);
    const restored = local.restoreTerms(protectedText.text, protectedText.placeholders);

    expect(protectedText.placeholders.map((entry) => entry.term)).toEqual(['Vector Database']);
    expect(restored.text).toContain('Vector Database');
  });

  it('does not match a term inside a longer word', () => {
    const protectedText = service.protectTerms('The rapids and the API differ.', ['API']);
    expect(protectedText.text).toContain('rapids');
    expect(protectedText.text).not.toContain('rAPIds');
  });

  it('restores placeholders the model reformatted', () => {
    const protectedText = service.protectTerms('The API is fast.', ['API']);
    // A model that added spaces and rendered the index in Arabic-Indic digits.
    const mangled = protectedText.text.replace(termPlaceholder(0), '[[ TH ٠ ]]');
    const restored = service.restoreTerms(mangled, protectedText.placeholders);

    expect(restored.text).toContain('API');
    expect(restored.restoredTerms).toEqual(['API']);
  });

  it('reports the terms a model deleted and removes tokens it invented', () => {
    const protectedText = service.protectTerms('The API is fast.', ['API']);
    const restored = service.restoreTerms('النظام سريع [[TH7]]', protectedText.placeholders);

    expect(restored.droppedTerms).toEqual(['API']);
    expect(restored.text).not.toContain('[[');
  });

  it('returns the text untouched when there is nothing to protect', () => {
    const protectedText = service.protectTerms('لا يوجد مصطلح هنا.', []);
    expect(protectedText.text).toBe('لا يوجد مصطلح هنا.');
    expect(protectedText.placeholders).toEqual([]);
  });
});

describe('containsTerm', () => {
  it('matches whole terms only, ignoring case', () => {
    expect(containsTerm('we use an api daily', 'API')).toBe(true);
    expect(containsTerm('rapids', 'API')).toBe(false);
    expect(containsTerm('CI/CD pipelines', 'CI/CD')).toBe(true);
    expect(containsTerm('fine-tuning a model', 'Fine-tuning')).toBe(true);
  });
});
