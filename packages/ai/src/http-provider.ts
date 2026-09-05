import { UpstreamError, characterCount, truncate } from '@trendhunter/shared';
import type {
  ClassificationResult,
  ClassifyRequest,
  EmbedOutput,
  EmbedRequest,
  EmbeddingProvider,
  GenerateRequest,
  GeneratedPost,
  GeneratedThread,
  LlmCallMeta,
  LlmProvider,
  LlmResult,
  LlmUsage,
  SummarizeRequest,
  TranslateRequest,
  TranslationOutput,
} from '@trendhunter/types';
import type { z } from 'zod';

import { estimateTokens } from './analysis';
import { clampThreadLength } from './composer';
import {
  chatCompletionResponseSchema,
  classificationResultSchema,
  embedOutputSchema,
  embeddingsResponseSchema,
  generatedPostSchema,
  generatedThreadSchema,
  llmClassificationPayloadSchema,
  llmPostPayloadSchema,
  llmSummaryPayloadSchema,
  llmThreadPayloadSchema,
  llmTranslationPayloadSchema,
  parseLlmResponse,
  summarySchema,
  translationOutputSchema,
} from './schemas';

/**
 * Adapter for a hosted, OpenAI-compatible HTTP API.
 *
 * It is deliberately small. Development never exercises it — the offline
 * provider is the default everywhere without a key — so the value here is in
 * being obviously correct rather than clever:
 *
 *  - configuration is injected, never read from the process environment;
 *  - every request carries an abort signal, because a hung upstream would
 *    otherwise hold a worker slot or a Fastify connection open indefinitely;
 *  - the API key is redacted out of anything that could reach a log or a
 *    client, including a body the upstream echoes back;
 *  - responses are validated twice — the envelope, then the JSON the model was
 *    asked to put inside it.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TokenPricing {
  /** USD per million prompt tokens. */
  readonly promptPerMillion: number;
  /** USD per million completion tokens. */
  readonly completionPerMillion: number;
}

export interface HttpLlmProviderConfig {
  /** Provider name recorded in usage rows and errors, e.g. `openai`. */
  readonly name: string;
  /** API root, without a trailing slash, e.g. `https://api.openai.com/v1`. */
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly embeddingModel?: string;
  /** Expected embedding width; a mismatch is rejected rather than stored. */
  readonly dimensions?: number;
  readonly timeoutMs?: number;
  /** Injected in tests; defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /**
   * Used when the vendor has no embeddings endpoint. Anthropic is the case
   * that matters: without a delegate, clustering and semantic search would be
   * silently dead for anyone who selected that provider.
   */
  readonly embeddingProvider?: EmbeddingProvider;
  /** Pricing for the cost estimate; zero when the deployment has not set it. */
  readonly pricing?: TokenPricing;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Longest upstream error body quoted back, after redaction. */
const ERROR_BODY_LIMIT = 300;

const JSON_INSTRUCTION =
  'Reply with a single JSON object and nothing else. Do not wrap it in Markdown.';

export class HttpLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;

  readonly #config: HttpLlmProviderConfig;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(config: HttpLlmProviderConfig) {
    this.name = config.name;
    this.model = config.model;
    this.#config = config;
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generate(request: GenerateRequest): Promise<LlmResult<GeneratedPost | GeneratedThread>> {
    const system = [
      `You write ${request.language === 'AR' ? 'Arabic' : 'English'} social content for X.`,
      `Tone: ${request.tone.toLowerCase()}. Draft kind: ${request.kind}.`,
      JSON_INSTRUCTION,
    ].join(' ');

    if (request.kind === 'X_THREAD') {
      const length = clampThreadLength(request.threadLength);
      const user = [
        buildContextPrompt(request),
        `Write a thread of exactly ${length} posts: a hook, body posts that build on each other, and a conclusion.`,
        'Shape: {"title": string, "posts": string[]}.',
      ].join('\n');

      const { payload, usage, durationMs } = await this.#chat(
        'generate',
        system,
        user,
        llmThreadPayloadSchema,
      );
      const value = parseLlmResponse(
        generatedThreadSchema,
        {
          title: payload.title,
          posts: payload.posts.map((content) => ({
            title: null,
            content,
            characterCount: characterCount(content),
          })),
        },
        { provider: this.name, operation: 'generate' },
      );
      return { value, meta: this.#meta(usage, durationMs) };
    }

    const user = [
      buildContextPrompt(request),
      request.maxCharacters === undefined ? '' : `Stay within ${request.maxCharacters} characters.`,
      'Shape: {"title": string | null, "content": string}.',
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const { payload, usage, durationMs } = await this.#chat(
      'generate',
      system,
      user,
      llmPostPayloadSchema,
    );
    const value = parseLlmResponse(
      generatedPostSchema,
      {
        title: payload.title ?? null,
        content: payload.content,
        characterCount: characterCount(payload.content),
      },
      { provider: this.name, operation: 'generate' },
    );
    return { value, meta: this.#meta(usage, durationMs) };
  }

  async summarize(request: SummarizeRequest): Promise<LlmResult<string>> {
    const { payload, usage, durationMs } = await this.#chat(
      'summarize',
      `You summarise text in ${request.language === 'AR' ? 'Arabic' : 'English'}. ${JSON_INSTRUCTION}`,
      [
        `Summarise the following in at most ${request.maxSentences} sentences.`,
        'Shape: {"summary": string}.',
        '---',
        request.text,
      ].join('\n'),
      llmSummaryPayloadSchema,
    );

    const value = parseLlmResponse(summarySchema, payload.summary, {
      provider: this.name,
      operation: 'summarize',
    });
    return { value, meta: this.#meta(usage, durationMs) };
  }

  async classify(request: ClassifyRequest): Promise<LlmResult<ClassificationResult>> {
    const { payload, usage, durationMs } = await this.#chat(
      'classify',
      `You classify text against a fixed label set. ${JSON_INSTRUCTION}`,
      [
        `Labels: ${request.labels.join(', ')}.`,
        'Shape: {"label": string, "confidence": number between 0 and 1, "matchedLabels": [{"label": string, "confidence": number}]}.',
        '---',
        request.text,
      ].join('\n'),
      llmClassificationPayloadSchema,
    );

    const value = parseLlmResponse(
      classificationResultSchema,
      {
        label: payload.label,
        confidence: payload.confidence,
        matchedLabels: payload.matchedLabels ?? [
          { label: payload.label, confidence: payload.confidence },
        ],
      },
      { provider: this.name, operation: 'classify' },
    );
    return { value, meta: this.#meta(usage, durationMs) };
  }

  async translate(request: TranslateRequest): Promise<LlmResult<TranslationOutput>> {
    const preserve =
      request.preserveTerms.length > 0
        ? `Leave these terms untranslated, in Latin script: ${request.preserveTerms.join(', ')}.`
        : 'There are no terms that must stay untranslated.';

    const { payload, usage, durationMs } = await this.#chat(
      'translate',
      `You translate from ${request.sourceLanguage} to ${request.targetLanguage}. ${JSON_INSTRUCTION}`,
      [
        `Mode: ${request.mode}. Terminology preference: ${request.terminologyPreference}.`,
        preserve,
        request.contextSummary === undefined
          ? ''
          : `Surrounding context: ${request.contextSummary}`,
        'Shape: {"translatedText": string, "preservedTerms": string[], "explanation": string}.',
        '---',
        request.text,
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
      llmTranslationPayloadSchema,
    );

    const value = parseLlmResponse(
      translationOutputSchema,
      {
        translatedText: payload.translatedText,
        // A model will happily claim it kept a term it dropped, so the reported
        // list is filtered down to the ones actually present in the output.
        preservedTerms: (payload.preservedTerms ?? request.preserveTerms).filter((term) =>
          payload.translatedText.includes(term),
        ),
        explanation: payload.explanation ?? null,
      },
      { provider: this.name, operation: 'translate' },
    );
    return { value, meta: this.#meta(usage, durationMs) };
  }

  async embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>> {
    const delegate = this.#config.embeddingProvider;
    if (delegate) return delegate.embed(request);

    const model = this.#config.embeddingModel ?? this.#config.model;
    const started = performance.now();
    const body = await this.#post('embed', '/embeddings', { model, input: [...request.texts] });
    const durationMs = elapsed(started);

    const response = parseLlmResponse(embeddingsResponseSchema, body, {
      provider: this.name,
      operation: 'embed',
    });

    const ordered = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const dimensions = this.#config.dimensions ?? ordered[0]?.embedding.length ?? 0;

    const value = parseLlmResponse(
      embedOutputSchema,
      {
        vectors: ordered.map((entry) => entry.embedding),
        dimensions,
        model: response.model ?? model,
      },
      { provider: this.name, operation: 'embed' },
    );

    const promptTokens = response.usage?.prompt_tokens ?? estimateTokens(request.texts.join(' '));
    return {
      value,
      meta: this.#meta(
        { promptTokens, completionTokens: 0, totalTokens: promptTokens },
        durationMs,
      ),
    };
  }

  /** One chat completion, validated envelope then validated JSON body. */
  async #chat<TSchema extends z.ZodType>(
    operation: string,
    system: string,
    user: string,
    schema: TSchema,
  ): Promise<{ payload: z.infer<TSchema>; usage: RawUsage; durationMs: number }> {
    const started = performance.now();
    const body = await this.#post(operation, '/chat/completions', {
      model: this.#config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    });
    const durationMs = elapsed(started);

    const envelope = parseLlmResponse(chatCompletionResponseSchema, body, {
      provider: this.name,
      operation,
    });
    const content = envelope.choices[0]?.message.content ?? '';

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new UpstreamError(this.name, `The ${operation} response was not valid JSON.`, {
        cause: error,
        details: { operation },
      });
    }

    const payload = parseLlmResponse(schema, parsed, { provider: this.name, operation });
    return {
      payload,
      usage: {
        promptTokens: envelope.usage?.prompt_tokens ?? estimateTokens(`${system}${user}`),
        completionTokens: envelope.usage?.completion_tokens ?? estimateTokens(content),
        totalTokens: envelope.usage?.total_tokens,
      },
      durationMs,
    };
  }

  /**
   * Sends one JSON request.
   *
   * Transport failures, timeouts and non-2xx statuses all become an
   * `UpstreamError`; nothing that could carry the credential escapes. The key
   * is scrubbed from the quoted body because upstream error payloads
   * occasionally echo the offending Authorization header back.
   */
  async #post(operation: string, path: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new UpstreamError(
        this.name,
        timedOut
          ? `The ${operation} request timed out after ${this.#timeoutMs}ms.`
          : `The ${operation} request could not be completed.`,
        { details: { operation }, cause: error },
      );
    }

    if (!response.ok) {
      const detail = await this.#safeBody(response);
      throw new UpstreamError(
        this.name,
        `The ${operation} request failed with status ${response.status}.`,
        { details: { operation, status: response.status, body: detail } },
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new UpstreamError(this.name, `The ${operation} response was not valid JSON.`, {
        cause: error,
        details: { operation },
      });
    }
  }

  async #safeBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return truncate(this.#redact(text), ERROR_BODY_LIMIT);
    } catch {
      return '';
    }
  }

  #redact(value: string): string {
    const key = this.#config.apiKey;
    return key.length > 0 ? value.replaceAll(key, '[redacted]') : value;
  }

  #meta(usage: RawUsage, durationMs: number): LlmCallMeta {
    return {
      provider: this.name,
      model: this.model,
      usage: this.#usage(usage),
      durationMs,
    };
  }

  #usage(usage: RawUsage): LlmUsage {
    const totalTokens = usage.totalTokens ?? usage.promptTokens + usage.completionTokens;
    const pricing = this.#config.pricing;
    const estimatedCost =
      pricing === undefined
        ? 0
        : (usage.promptTokens * pricing.promptPerMillion +
            usage.completionTokens * pricing.completionPerMillion) /
          1_000_000;
    return {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens,
      estimatedCost,
    };
  }
}

interface RawUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens?: number | undefined;
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

function buildContextPrompt(request: GenerateRequest): string {
  const { context } = request;
  const lines = [`Topic: ${context.topicName}`];
  if (context.topicSummary !== null) lines.push(`Summary: ${context.topicSummary}`);
  if (context.interests.length > 0) lines.push(`Reader interests: ${context.interests.join(', ')}`);
  if (context.arabicOpportunityScore !== null) {
    lines.push(`Arabic content gap score: ${context.arabicOpportunityScore}/100`);
  }
  for (const excerpt of context.sourceExcerpts.slice(0, 5)) lines.push(`Source: ${excerpt}`);
  return lines.join('\n');
}
