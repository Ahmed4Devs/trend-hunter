import { LlmProviderError, ValidationError } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import { SameLanguageError, TranslationService } from '../src/translation-service';
import { FakeLlmProvider } from './fake-provider';

const ENGLISH_POST =
  'The new API returns a token in 87 milliseconds, and the SDK for GraphQL is open source.';

function serviceWith(provider: FakeLlmProvider): TranslationService {
  return new TranslationService(provider);
}

describe('TranslationService.translate', () => {
  it('translates English into Arabic and keeps the technical terms verbatim', async () => {
    const provider = new FakeLlmProvider();
    const result = await serviceWith(provider).translate({
      text: ENGLISH_POST,
      targetLanguage: 'AR',
    });

    expect(result.sourceLanguage).toBe('EN');
    expect(result.targetLanguage).toBe('AR');
    expect(result.mode).toBe('X_STYLE');
    expect(result.translatedText).toContain('API');
    expect(result.translatedText).toContain('SDK');
    expect(result.translatedText).toContain('GraphQL');
    expect(result.preservedTerms).toEqual(expect.arrayContaining(['API', 'SDK', 'GraphQL']));
    expect(result.characterCount).toBeGreaterThan(0);
  });

  it('never shows the model the terms it must not translate', async () => {
    const provider = new FakeLlmProvider();
    await serviceWith(provider).translate({ text: ENGLISH_POST, targetLanguage: 'AR' });

    const sent = provider.translateRequests[0];
    expect(sent).toBeDefined();
    expect(sent?.text).not.toContain('API');
    expect(sent?.text).toContain('[[TH');
    expect(sent?.contextSummary).toContain('Copy these placeholders through unchanged');
  });

  it('refuses text that is already in the target language', async () => {
    const provider = new FakeLlmProvider();
    await expect(
      serviceWith(provider).translate({
        text: 'هذا النص مكتوب بالعربية بالفعل ولا يحتاج إلى ترجمة.',
        targetLanguage: 'AR',
      }),
    ).rejects.toBeInstanceOf(SameLanguageError);
    expect(provider.translateRequests).toHaveLength(0);
  });

  it('refuses an empty source and an unsupported target', async () => {
    const service = serviceWith(new FakeLlmProvider());
    await expect(service.translate({ text: '   ', targetLanguage: 'AR' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      service.translate({ text: ENGLISH_POST, targetLanguage: 'OTHER' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('converts Arabic-Indic digits the model produced', async () => {
    const provider = new FakeLlmProvider({
      translateOverride: () => ({
        translatedText: 'يعيد النظام رمزا خلال ٨٧ جزءا من الثانية وهو أمر جيد جدا للمستخدمين.',
        preservedTerms: [],
        explanation: null,
      }),
    });
    const result = await serviceWith(provider).translate({
      text: ENGLISH_POST,
      targetLanguage: 'AR',
    });

    expect(result.translatedText).toContain('87');
    expect(result.translatedText).not.toContain('٨٧');
  });

  it('applies the requested mode and explains it', async () => {
    const provider = new FakeLlmProvider();
    const literal = await serviceWith(provider).translate({
      text: ENGLISH_POST,
      targetLanguage: 'AR',
      mode: 'LITERAL',
    });

    expect(literal.mode).toBe('LITERAL');
    expect(literal.explanation).toContain('Keeps the source structure intact');
    expect(literal.explanation).toContain('Kept in English');
  });

  it('honours the terminology preference', async () => {
    const provider = new FakeLlmProvider();
    const result = await serviceWith(provider).translate({
      text: ENGLISH_POST,
      targetLanguage: 'AR',
      terminologyPreference: 'FULL_ARABIC',
    });

    // Only proper nouns and code identifiers survive; the acronyms do not.
    expect(result.preservedTerms).not.toContain('API');
    expect(result.preservedTerms).toContain('GraphQL');
  });

  it('keeps caller-supplied vocabulary as well', async () => {
    const provider = new FakeLlmProvider();
    const result = await serviceWith(provider).translate({
      text: 'Our Falconry product shipped this week with a new dashboard.',
      targetLanguage: 'AR',
      additionalPreserveTerms: ['Falconry'],
    });

    expect(result.translatedText).toContain('Falconry');
  });
});

describe('TranslationService provider validation', () => {
  it('rejects a payload that is not an object', async () => {
    const provider = new FakeLlmProvider({ translateOverride: () => 'just a string' });
    await expect(
      serviceWith(provider).translate({ text: ENGLISH_POST, targetLanguage: 'AR' }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('rejects a payload with no translated text', async () => {
    const provider = new FakeLlmProvider({
      translateOverride: () => ({ translatedText: '   ', preservedTerms: [], explanation: null }),
    });
    await expect(
      serviceWith(provider).translate({ text: ENGLISH_POST, targetLanguage: 'AR' }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('rejects output that never reached the target language', async () => {
    const provider = new FakeLlmProvider({
      translateOverride: () => ({
        translatedText: 'I am sorry, but I cannot translate that request for you today.',
        preservedTerms: [],
        explanation: null,
      }),
    });
    await expect(
      serviceWith(provider).translate({ text: ENGLISH_POST, targetLanguage: 'AR' }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('rejects output of an implausible length', async () => {
    const provider = new FakeLlmProvider({
      translateOverride: () => ({
        translatedText: 'نعم',
        preservedTerms: [],
        explanation: null,
      }),
    });
    await expect(
      serviceWith(provider).translate({ text: ENGLISH_POST, targetLanguage: 'AR' }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('tolerates a payload with a malformed preserved-terms array', async () => {
    const provider = new FakeLlmProvider({
      translateOverride: (request) => ({
        translatedText: `النموذج الجديد سريع جدا في الإنتاج ${request.preserveTerms.join(' ')}`,
        preservedTerms: [42, null, 'API'],
        explanation: 7,
      }),
    });
    const result = await serviceWith(provider).translate({
      text: ENGLISH_POST,
      targetLanguage: 'AR',
    });

    expect(result.translatedText).toContain('النموذج');
  });
});
