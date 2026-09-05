import { LlmProviderError } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  chatCompletionResponseSchema,
  embeddingsResponseSchema,
  generatedPostSchema,
  generatedThreadSchema,
  llmClassificationPayloadSchema,
  llmTranslationPayloadSchema,
  parseLlmResponse,
} from '../src/schemas';
import { ApiUsageRecorder, isLlmOperation } from '../src/usage';

/**
 * Model output is untrusted input. These tests exist because the failure mode
 * they guard against is silent: an unvalidated response with a missing field
 * flows on as `undefined` and surfaces three layers away as a broken draft or a
 * NaN character count.
 */

describe('parseLlmResponse', () => {
  const context = { provider: 'test-provider', operation: 'generate' as const };

  it('returns the parsed value on success', () => {
    const value = parseLlmResponse(
      generatedPostSchema,
      { title: null, content: 'hello', characterCount: 5 },
      context,
    );
    expect(value.content).toBe('hello');
  });

  it('raises LlmProviderError, not ZodError, on a malformed payload', () => {
    // A ZodError escaping this package would reach the HTTP error handler as an
    // unknown failure and be reported as a client validation problem.
    expect(() => parseLlmResponse(generatedPostSchema, { content: 123 }, context)).toThrow(
      LlmProviderError,
    );
  });

  it('records the provider structurally and never echoes the payload', () => {
    try {
      parseLlmResponse(generatedPostSchema, { secretKey: 'sk-live-abc123' }, context);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      const thrown = error as LlmProviderError;

      // The provider is a field, not string-interpolated into the message, so
      // it can be logged and filtered without parsing prose.
      expect(thrown.provider).toBe('test-provider');
      expect(thrown.details).toMatchObject({ operation: 'generate' });

      // The rejected payload is the one place model output would otherwise be
      // copied verbatim into an error that is logged and exposed.
      const serialised = `${thrown.message}${JSON.stringify(thrown.details)}`;
      expect(serialised).not.toContain('sk-live-abc123');
    }
  });

  it('rejects null and undefined outright', () => {
    expect(() => parseLlmResponse(generatedPostSchema, null, context)).toThrow(LlmProviderError);
    expect(() => parseLlmResponse(generatedPostSchema, undefined, context)).toThrow(
      LlmProviderError,
    );
  });
});

describe('generatedThreadSchema', () => {
  it('accepts a well-formed thread', () => {
    const result = generatedThreadSchema.safeParse({
      title: 'A thread',
      posts: [
        { title: null, content: 'one', characterCount: 3 },
        { title: null, content: 'two', characterCount: 3 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('refuses a thread with no posts', () => {
    expect(generatedThreadSchema.safeParse({ title: 'x', posts: [] }).success).toBe(false);
  });

  it('refuses a post with empty content', () => {
    expect(
      generatedThreadSchema.safeParse({
        title: 'x',
        posts: [{ title: null, content: '   ', characterCount: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('llmClassificationPayloadSchema', () => {
  it('refuses a confidence outside 0..1', () => {
    expect(
      llmClassificationPayloadSchema.safeParse({ label: 'AI', confidence: 1.5, matchedLabels: [] })
        .success,
    ).toBe(false);
    expect(
      llmClassificationPayloadSchema.safeParse({ label: 'AI', confidence: -0.1, matchedLabels: [] })
        .success,
    ).toBe(false);
  });
});

describe('llmTranslationPayloadSchema', () => {
  it('refuses empty translated text', () => {
    const result = llmTranslationPayloadSchema.safeParse({
      translatedText: '',
      preservedTerms: [],
      explanation: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('chatCompletionResponseSchema', () => {
  it('accepts the OpenAI-compatible shape', () => {
    const result = chatCompletionResponseSchema.safeParse({
      choices: [{ message: { content: '{"content":"hi"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    });
    expect(result.success).toBe(true);
  });

  it('refuses a response with no choices', () => {
    expect(chatCompletionResponseSchema.safeParse({ choices: [] }).success).toBe(false);
  });

  it('refuses a truncated response missing the message body', () => {
    expect(chatCompletionResponseSchema.safeParse({ choices: [{}] }).success).toBe(false);
  });
});

describe('embeddingsResponseSchema', () => {
  it('accepts a well-formed embeddings response', () => {
    const result = embeddingsResponseSchema.safeParse({
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      model: 'text-embedding-3-small',
    });
    expect(result.success).toBe(true);
  });

  it('refuses a non-finite component that would corrupt the vector index', () => {
    const result = embeddingsResponseSchema.safeParse({
      data: [{ embedding: [0.1, Number.NaN], index: 0 }],
      model: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('refuses an empty data array', () => {
    expect(embeddingsResponseSchema.safeParse({ data: [], model: 'x' }).success).toBe(false);
  });
});

describe('ApiUsageRecorder', () => {
  it('accumulates counts per provider and operation', () => {
    const recorder = new ApiUsageRecorder();
    recorder.record({ provider: 'mock', operation: 'generate', success: true });
    recorder.record({ provider: 'mock', operation: 'generate', success: true });
    recorder.record({ provider: 'mock', operation: 'generate', success: false });
    recorder.record({ provider: 'mock', operation: 'translate', success: true });

    const entries = recorder.drain();
    const generate = entries.find((entry) => entry.operation === 'generate');
    expect(generate).toMatchObject({
      provider: 'mock',
      requestCount: 3,
      successCount: 2,
      failureCount: 1,
    });
    expect(entries).toHaveLength(2);
  });

  it('accumulates estimated cost', () => {
    const recorder = new ApiUsageRecorder();
    recorder.record({
      provider: 'openai',
      operation: 'embed',
      success: true,
      estimatedCost: 0.002,
    });
    recorder.record({
      provider: 'openai',
      operation: 'embed',
      success: true,
      estimatedCost: 0.003,
    });
    const entry = recorder.drain()[0];
    expect(entry?.estimatedCost).toBeCloseTo(0.005, 6);
  });

  it('empties itself on drain, so a flush cannot double-count', () => {
    const recorder = new ApiUsageRecorder();
    recorder.record({ provider: 'mock', operation: 'classify', success: true });
    expect(recorder.drain()).toHaveLength(1);
    expect(recorder.drain()).toHaveLength(0);
  });
});

describe('isLlmOperation', () => {
  it('recognises the known operations', () => {
    for (const operation of ['generate', 'summarize', 'classify', 'translate', 'embed']) {
      expect(isLlmOperation(operation)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isLlmOperation('delete-everything')).toBe(false);
  });
});
