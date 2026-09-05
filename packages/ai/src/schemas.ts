import { LlmProviderError } from '@trendhunter/shared';
import { z } from 'zod';

/**
 * The validation boundary of the AI layer.
 *
 * Everything an LLM returns is untrusted input: a hosted model can answer with
 * prose where JSON was asked for, invent a field, or return a 4 000-dimension
 * vector for a 768-dimension request. Nothing leaves this package without
 * passing through one of these schemas first, so the rest of the platform can
 * treat `LlmResult` values as facts.
 *
 * Two families live here:
 *  - *domain* schemas mirror the interfaces in `@trendhunter/types` and guard
 *    the value a provider hands back;
 *  - *wire* schemas describe what a hosted model is asked to produce, which is
 *    deliberately smaller — derived fields such as `characterCount` are
 *    computed here rather than trusted from the model.
 */

const nonEmptyText = z.string().trim().min(1);

export const llmUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative(),
});

export const generatedPostSchema = z.object({
  title: nonEmptyText.max(200).nullable(),
  content: nonEmptyText,
  characterCount: z.number().int().positive(),
});

export const generatedThreadSchema = z.object({
  title: nonEmptyText.max(200),
  posts: z.array(generatedPostSchema).min(1),
});

export const classificationResultSchema = z.object({
  label: nonEmptyText,
  confidence: z.number().min(0).max(1),
  matchedLabels: z.array(
    z.object({ label: nonEmptyText, confidence: z.number().min(0).max(1) }),
  ),
});

export const translationOutputSchema = z.object({
  translatedText: nonEmptyText,
  preservedTerms: z.array(nonEmptyText),
  explanation: nonEmptyText.max(500).nullable(),
});

/**
 * Embedding output.
 *
 * The width is checked per vector rather than only on the header: a provider
 * that silently truncates one row would otherwise poison a single cluster in a
 * way that is almost impossible to trace back from the ranking output.
 */
export const embedOutputSchema = z
  .object({
    vectors: z.array(z.array(z.number())),
    dimensions: z.number().int().positive(),
    model: nonEmptyText,
  })
  .refine((value) => value.vectors.every((vector) => vector.length === value.dimensions), {
    message: 'every vector must have exactly `dimensions` components',
    path: ['vectors'],
  });

export const summarySchema = nonEmptyText;

/** What a hosted model is asked to return for a single-post generation. */
export const llmPostPayloadSchema = z.object({
  title: nonEmptyText.max(200).nullish(),
  content: nonEmptyText,
});

/** What a hosted model is asked to return for a thread generation. */
export const llmThreadPayloadSchema = z.object({
  title: nonEmptyText.max(200),
  posts: z.array(nonEmptyText).min(1),
});

export const llmSummaryPayloadSchema = z.object({ summary: nonEmptyText });

export const llmClassificationPayloadSchema = z.object({
  label: nonEmptyText,
  confidence: z.number().min(0).max(1),
  matchedLabels: z
    .array(z.object({ label: nonEmptyText, confidence: z.number().min(0).max(1) }))
    .optional(),
});

export const llmTranslationPayloadSchema = z.object({
  translatedText: nonEmptyText,
  preservedTerms: z.array(nonEmptyText).optional(),
  explanation: nonEmptyText.max(500).nullish(),
});

/** OpenAI-compatible `POST /chat/completions` response. */
export const chatCompletionResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

/** OpenAI-compatible `POST /embeddings` response. */
export const embeddingsResponseSchema = z.object({
  data: z
    .array(z.object({ index: z.number().int().nonnegative().optional(), embedding: z.array(z.number()) }))
    .min(1),
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type LlmPostPayload = z.infer<typeof llmPostPayloadSchema>;
export type LlmThreadPayload = z.infer<typeof llmThreadPayloadSchema>;
export type LlmClassificationPayload = z.infer<typeof llmClassificationPayloadSchema>;
export type LlmTranslationPayload = z.infer<typeof llmTranslationPayloadSchema>;
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;
export type EmbeddingsResponse = z.infer<typeof embeddingsResponseSchema>;

export interface LlmParseContext {
  readonly provider: string;
  /** `generate`, `translate`, … — appears in the error and in the usage table. */
  readonly operation: string;
}

/** Issues reported on a failure, capped so a bad batch cannot flood the logs. */
const MAX_REPORTED_ISSUES = 5;

/**
 * Validates a provider payload, or fails with a {@link LlmProviderError}.
 *
 * Only the failing *paths* and Zod's own messages are attached — never the
 * offending value. A rejected payload is the one place where model output would
 * otherwise be copied verbatim into an error that is exposed to the client and
 * written to the logs.
 */
export function parseLlmResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  context: LlmParseContext,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

  throw new LlmProviderError(
    context.provider,
    `The ${context.operation} response did not match the expected shape.`,
    { details: { operation: context.operation, issues } },
  );
}
