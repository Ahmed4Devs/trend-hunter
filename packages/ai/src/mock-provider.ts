import {
  EMBEDDING_DIMENSIONS,
  ValidationError,
  characterCount,
  detectLanguage,
  round,
} from '@trendhunter/shared';
import type {
  ClassificationResult,
  ClassifyRequest,
  EmbedOutput,
  EmbedRequest,
  GenerateRequest,
  GeneratedPost,
  GeneratedThread,
  LlmCallMeta,
  LlmProvider,
  LlmResult,
  SummarizeRequest,
  TranslateRequest,
  TranslationOutput,
} from '@trendhunter/types';

import { embedText, estimateTokens, extractiveSummary, scoreLabels } from './analysis';
import { clampThreadLength, composePost, composeThread } from './composer';
import { createRng, stableSeed, type Rng } from './deterministic';
import {
  classificationResultSchema,
  embedOutputSchema,
  generatedPostSchema,
  generatedThreadSchema,
  parseLlmResponse,
  summarySchema,
  translationOutputSchema,
} from './schemas';
import { translateText } from './translator';

/**
 * The offline provider.
 *
 * This is the default in every environment that has no API key, which in
 * practice means development, CI and any reviewer running the stack for the
 * first time. It is therefore held to the same contract as a hosted provider:
 * it validates its own output against the same schemas, reports usage, and
 * never returns a shape the rest of the platform has to defend against.
 *
 * Its one hard rule is determinism. Every choice is driven by a PRNG seeded
 * from the request, so the same request always produces byte-identical output —
 * that is what makes the Content Studio stable across refreshes and lets the
 * clustering and search packages assert on real similarity numbers.
 */

export const MOCK_PROVIDER_NAME = 'mock';
export const DEFAULT_MOCK_MODEL = 'trendhunter-mock-v1';

/** Returned by `classify` when no candidate label overlaps the text at all. */
export const UNCLASSIFIED_LABEL = 'unclassified';

/** Simulated latency envelope, in milliseconds. */
const LATENCY_RANGE = { min: 18, spread: 140 } as const;

export interface MockLlmProviderOptions {
  readonly model?: string;
  readonly dimensions?: number;
}

export class MockLlmProvider implements LlmProvider {
  readonly name = MOCK_PROVIDER_NAME;
  readonly model: string;
  readonly dimensions: number;

  constructor(options: MockLlmProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_MOCK_MODEL;
    this.dimensions = Math.max(1, Math.floor(options.dimensions ?? EMBEDDING_DIMENSIONS));
  }

  generate(request: GenerateRequest): Promise<LlmResult<GeneratedPost | GeneratedThread>> {
    const seed = stableSeed([
      'generate',
      request.kind,
      request.language,
      request.tone,
      request.maxCharacters,
      request.threadLength,
      request.context.topicName,
      request.context.topicSummary,
      request.context.arabicOpportunityScore,
      ...request.context.sourceExcerpts,
      ...request.context.interests,
    ]);
    const rng = createRng(seed);
    const prompt = promptTextFor(request);

    if (request.kind === 'X_THREAD') {
      const composed = composeThread({
        kind: request.kind,
        language: request.language,
        tone: request.tone,
        context: request.context,
        maxCharacters: request.maxCharacters,
        threadLength: clampThreadLength(request.threadLength),
        rng,
      });
      const value = parseLlmResponse(generatedThreadSchema, toThread(composed), {
        provider: this.name,
        operation: 'generate',
      });
      const completion = value.posts.map((post) => post.content).join('\n');
      return Promise.resolve({ value, meta: this.#meta(seed, prompt, completion) });
    }

    const composed = composePost({
      kind: request.kind,
      language: request.language,
      tone: request.tone,
      context: request.context,
      maxCharacters: request.maxCharacters,
      rng,
    });
    const value = parseLlmResponse(generatedPostSchema, toPost(composed), {
      provider: this.name,
      operation: 'generate',
    });
    return Promise.resolve({ value, meta: this.#meta(seed, prompt, value.content) });
  }

  summarize(request: SummarizeRequest): Promise<LlmResult<string>> {
    const text = request.text.trim();
    if (text.length === 0) {
      throw new ValidationError('There is nothing to summarise.');
    }

    const seed = stableSeed(['summarize', request.language, request.maxSentences, text]);
    const extract = extractiveSummary(text, request.maxSentences);
    const detected = detectLanguage(text).language;

    // An extract is in the language of its source. When the caller asked for a
    // different one, it goes through the same translator the Translations page
    // uses rather than being returned in the wrong language.
    const summary =
      detected === request.language || request.language === 'OTHER'
        ? extract
        : translateText(extract, {
            sourceLanguage: detected,
            targetLanguage: request.language,
            mode: 'NATURAL',
            terminologyPreference: 'KEEP_COMMON_ENGLISH_TERMS',
            preserveTerms: [],
            rng: createRng(seed),
          }).text;

    const value = parseLlmResponse(summarySchema, summary, {
      provider: this.name,
      operation: 'summarize',
    });
    return Promise.resolve({ value, meta: this.#meta(seed, text, value) });
  }

  classify(request: ClassifyRequest): Promise<LlmResult<ClassificationResult>> {
    const seed = stableSeed(['classify', request.text, ...request.labels]);
    const scored = scoreLabels(request.text, request.labels);
    const best = scored[0];

    const value = parseLlmResponse(classificationResultSchema, toClassification(best, scored), {
      provider: this.name,
      operation: 'classify',
    });
    return Promise.resolve({
      value,
      meta: this.#meta(seed, request.text, value.label),
    });
  }

  translate(request: TranslateRequest): Promise<LlmResult<TranslationOutput>> {
    const text = request.text.trim();
    if (text.length === 0) {
      throw new ValidationError('There is nothing to translate.');
    }

    const seed = stableSeed([
      'translate',
      request.sourceLanguage,
      request.targetLanguage,
      request.mode,
      request.terminologyPreference,
      request.contextSummary,
      ...request.preserveTerms,
      text,
    ]);

    const draft = translateText(text, {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      mode: request.mode,
      terminologyPreference: request.terminologyPreference,
      preserveTerms: request.preserveTerms,
      rng: createRng(seed),
    });

    const value = parseLlmResponse(translationOutputSchema, toTranslation(draft), {
      provider: this.name,
      operation: 'translate',
    });
    return Promise.resolve({ value, meta: this.#meta(seed, text, value.translatedText) });
  }

  embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>> {
    const seed = stableSeed(['embed', this.dimensions, ...request.texts]);
    const vectors = request.texts.map((text) => embedText(text, this.dimensions));

    const value = parseLlmResponse(
      embedOutputSchema,
      toEmbedding(vectors, this.dimensions, this.model),
      { provider: this.name, operation: 'embed' },
    );
    return Promise.resolve({
      value,
      meta: this.#meta(seed, request.texts.join(' '), ''),
    });
  }

  /**
   * Usage and timing for one call.
   *
   * The duration is simulated from the seed rather than measured: a measured
   * value would be the one non-deterministic field in an otherwise reproducible
   * result and would break equality assertions on the whole `LlmResult`. The
   * instrumentation wrapper in `factory.ts` logs the real elapsed time
   * separately, which is where an operator would look for it anyway.
   */
  #meta(seed: string, prompt: string, completion: string): LlmCallMeta {
    const promptTokens = estimateTokens(prompt);
    const completionTokens = estimateTokens(completion);
    return {
      provider: this.name,
      model: this.model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0,
      },
      durationMs: simulatedDuration(createRng(`${seed}|latency`)),
    };
  }
}

function simulatedDuration(rng: Rng): number {
  return round(LATENCY_RANGE.min + rng.next() * LATENCY_RANGE.spread, 2);
}

function promptTextFor(request: GenerateRequest): string {
  return [
    request.context.topicName,
    request.context.topicSummary ?? '',
    ...request.context.sourceExcerpts,
    ...request.context.interests,
  ].join(' ');
}

function toPost(composed: { title: string | null; content: string }) {
  return {
    title: composed.title,
    content: composed.content,
    characterCount: characterCount(composed.content),
  };
}

function toThread(composed: { title: string; posts: readonly string[] }) {
  return {
    title: composed.title,
    posts: composed.posts.map((content) => ({
      title: null,
      content,
      characterCount: characterCount(content),
    })),
  };
}

function toClassification(
  best: { label: string; confidence: number } | undefined,
  scored: readonly { label: string; confidence: number }[],
) {
  if (!best) {
    // No candidate label shares any vocabulary with the text. Saying so is more
    // useful to the relevance engine than returning an arbitrary label at zero.
    return { label: UNCLASSIFIED_LABEL, confidence: 0, matchedLabels: [] };
  }
  return { label: best.label, confidence: best.confidence, matchedLabels: [...scored] };
}

function toTranslation(draft: {
  text: string;
  preservedTerms: readonly string[];
  explanation: string;
}) {
  return {
    translatedText: draft.text,
    preservedTerms: [...new Set(draft.preservedTerms)],
    explanation: draft.explanation,
  };
}

function toEmbedding(vectors: readonly (readonly number[])[], dimensions: number, model: string) {
  return { vectors: vectors.map((vector) => [...vector]), dimensions, model };
}
