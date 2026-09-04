import type {
  ContentDraftKind,
  ContentLanguage,
  ContentTone,
  TerminologyPreference,
  TranslationMode,
} from './enums';

/**
 * The LLM boundary.
 *
 * Nothing above this interface knows which vendor is answering. The default
 * development provider is deterministic and offline, so the whole product —
 * including translation, the Content Studio and relevance classification —
 * works end to end without a paid API key.
 *
 * Every provider response is parsed and validated before it is trusted; see
 * `@trendhunter/ai` for the Zod contracts.
 */

export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  /** Estimated cost in USD. Always 0 for the offline provider. */
  readonly estimatedCost: number;
}

export interface LlmCallMeta {
  readonly provider: string;
  readonly model: string;
  readonly usage: LlmUsage;
  readonly durationMs: number;
}

export interface LlmResult<TValue> {
  readonly value: TValue;
  readonly meta: LlmCallMeta;
}

export interface GenerateRequest {
  readonly kind: ContentDraftKind;
  readonly language: ContentLanguage;
  readonly tone: ContentTone;
  /** Topic name, summary and representative posts the model should draw on. */
  readonly context: GenerationContext;
  /** Hard character ceiling for a single post; omitted for threads. */
  readonly maxCharacters?: number;
  /** Number of posts requested when `kind` is `X_THREAD`. */
  readonly threadLength?: number;
}

export interface GenerationContext {
  readonly topicName: string;
  readonly topicSummary: string | null;
  readonly sourceExcerpts: readonly string[];
  readonly interests: readonly string[];
  readonly arabicOpportunityScore: number | null;
}

export interface GeneratedPost {
  readonly title: string | null;
  readonly content: string;
  readonly characterCount: number;
}

export interface GeneratedThread {
  readonly title: string;
  readonly posts: readonly GeneratedPost[];
}

export interface SummarizeRequest {
  readonly text: string;
  readonly language: ContentLanguage;
  readonly maxSentences: number;
}

export interface ClassifyRequest {
  readonly text: string;
  /** Candidate labels — typically the user's enabled interest names. */
  readonly labels: readonly string[];
}

export interface ClassificationResult {
  readonly label: string;
  /** 0..1 confidence. */
  readonly confidence: number;
  readonly matchedLabels: readonly { readonly label: string; readonly confidence: number }[];
}

export interface TranslateRequest {
  readonly text: string;
  readonly sourceLanguage: ContentLanguage;
  readonly targetLanguage: ContentLanguage;
  readonly mode: TranslationMode;
  readonly terminologyPreference: TerminologyPreference;
  /** Terms that must survive translation untouched. */
  readonly preserveTerms: readonly string[];
  /** Surrounding narrative used when translating one segment of a thread. */
  readonly contextSummary?: string;
}

export interface TranslationOutput {
  readonly translatedText: string;
  readonly preservedTerms: readonly string[];
  /** Short note on the localisation choices, shown in the Translations page. */
  readonly explanation: string | null;
}

export interface EmbedRequest {
  readonly texts: readonly string[];
}

export interface EmbedOutput {
  readonly vectors: readonly (readonly number[])[];
  readonly dimensions: number;
  readonly model: string;
}

/**
 * The single interface every AI vendor adapter implements.
 *
 * Implementations must be side-effect free apart from the network call, must
 * never throw raw provider errors (wrap them in `LlmProviderError`) and must
 * validate their own output before returning.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<LlmResult<GeneratedPost | GeneratedThread>>;
  summarize(request: SummarizeRequest): Promise<LlmResult<string>>;
  classify(request: ClassifyRequest): Promise<LlmResult<ClassificationResult>>;
  translate(request: TranslateRequest): Promise<LlmResult<TranslationOutput>>;
  embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>>;
}

/** Embedding-only providers (used by the ingestion pipeline). */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>>;
}
