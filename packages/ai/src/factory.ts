import { startTimer, type Logger } from '@trendhunter/observability';
import { AppError, EMBEDDING_DIMENSIONS, LlmProviderError } from '@trendhunter/shared';
import type {
  AiProviderName,
  EmbedRequest,
  EmbeddingProvider,
  LlmProvider,
  LlmResult,
} from '@trendhunter/types';

import { HttpLlmProvider, type FetchLike, type TokenPricing } from './http-provider';
import { MockLlmProvider } from './mock-provider';
import type { ApiUsageRecorder, LlmOperation } from './usage';

/**
 * Provider selection and instrumentation.
 *
 * Two rules shape this file. Configuration arrives as an argument — nothing
 * here reads the process environment, so a caller can construct a provider for
 * a test, a script or a request-scoped override without touching global state.
 * And every provider is wrapped before it is handed out, so usage accounting
 * and failure logging cannot be forgotten at a call site.
 */

/** Vendors whose default API root is known. */
const DEFAULT_BASE_URLS: Partial<Readonly<Record<AiProviderName, string>>> = {
  openai: 'https://api.openai.com/v1',
  // Anthropic serves an OpenAI-compatible chat completions endpoint here.
  anthropic: 'https://api.anthropic.com/v1',
};

/** Anthropic publishes no embeddings endpoint, so that half is delegated. */
const PROVIDERS_WITHOUT_EMBEDDINGS: ReadonlySet<AiProviderName> = new Set<AiProviderName>([
  'anthropic',
]);

export interface LlmProviderConfig {
  readonly provider?: AiProviderName;
  readonly model?: string;
  readonly baseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly dimensions?: number;
  readonly timeoutMs?: number;
  readonly pricing?: TokenPricing;
  /** Optional; when absent the provider simply is not logged. */
  readonly logger?: Logger;
  /** Optional; when absent usage is not accumulated. */
  readonly usageRecorder?: ApiUsageRecorder;
  /** Injected in tests. */
  readonly fetch?: FetchLike;
}

/** The slice of a validated environment this package needs. */
export interface AiEnvironmentSlice {
  readonly AI_PROVIDER: AiProviderName;
  readonly AI_MODEL: string;
  readonly AI_BASE_URL?: string | undefined;
  readonly LLM_API_KEY?: string | undefined;
  readonly EMBEDDING_DIMENSIONS: number;
}

/** Maps a parsed environment onto {@link LlmProviderConfig}. */
export function llmProviderConfigFromEnvironment(
  env: AiEnvironmentSlice,
  deps: Pick<LlmProviderConfig, 'logger' | 'usageRecorder' | 'fetch' | 'pricing' | 'timeoutMs'> = {},
): LlmProviderConfig {
  return {
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL,
    baseUrl: env.AI_BASE_URL,
    apiKey: env.LLM_API_KEY,
    dimensions: env.EMBEDDING_DIMENSIONS,
    ...deps,
  };
}

/**
 * Builds the configured provider, wrapped in timing, logging and usage
 * accounting.
 *
 * A hosted provider that is missing its credential or its base URL falls back
 * to the offline one with a warning rather than failing at start-up: the
 * product is designed to work without a key, and refusing to boot because an
 * optional integration is half-configured would be the wrong trade.
 */
export function createLlmProvider(config: LlmProviderConfig = {}): LlmProvider {
  return instrument(selectProvider(config), config);
}

/** The embedding-only view, for the ingestion pipeline. */
export function createEmbeddingProvider(config: LlmProviderConfig = {}): EmbeddingProvider {
  const provider = createLlmProvider(config);
  return {
    name: provider.name,
    model: provider.model,
    dimensions: config.dimensions ?? EMBEDDING_DIMENSIONS,
    embed: (request: EmbedRequest) => provider.embed(request),
  };
}

function selectProvider(config: LlmProviderConfig): LlmProvider {
  const name = config.provider ?? 'mock';
  if (name === 'mock') {
    return new MockLlmProvider({ model: config.model, dimensions: config.dimensions });
  }

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[name];
  const apiKey = config.apiKey;

  if (baseUrl === undefined || apiKey === undefined || apiKey.length === 0) {
    config.logger?.warn(
      { provider: name, hasBaseUrl: baseUrl !== undefined, hasApiKey: Boolean(apiKey) },
      'AI provider is not fully configured; falling back to the offline provider',
    );
    return new MockLlmProvider({ dimensions: config.dimensions });
  }

  return new HttpLlmProvider({
    name,
    baseUrl,
    apiKey,
    model: config.model ?? 'gpt-4o-mini',
    ...(config.dimensions === undefined ? {} : { dimensions: config.dimensions }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    ...(PROVIDERS_WITHOUT_EMBEDDINGS.has(name)
      ? { embeddingProvider: embeddingFallback(config) }
      : {}),
  });
}

/**
 * The offline embedder, used as the embedding half of a vendor that has no
 * embeddings API. Clustering and semantic search keep working; the vectors are
 * simply lexical rather than semantic, which is the same trade the whole
 * development environment already makes.
 */
function embeddingFallback(config: LlmProviderConfig): EmbeddingProvider {
  const mock = new MockLlmProvider({ dimensions: config.dimensions });
  return {
    name: mock.name,
    model: mock.model,
    dimensions: mock.dimensions,
    embed: (request: EmbedRequest) => mock.embed(request),
  };
}

/**
 * Wraps a provider so every call is timed, logged and counted.
 *
 * Failures are recorded before being re-thrown, and anything that is not
 * already an application error is converted into an `LlmProviderError` — a raw
 * vendor exception must never reach a route handler, where its message could be
 * serialised into a response.
 */
function instrument(provider: LlmProvider, config: LlmProviderConfig): LlmProvider {
  const { logger, usageRecorder } = config;

  const run = async <TValue>(
    operation: LlmOperation,
    call: () => Promise<LlmResult<TValue>>,
  ): Promise<LlmResult<TValue>> => {
    const timer = startTimer();
    try {
      const result = await call();
      usageRecorder?.record({
        provider: provider.name,
        operation,
        success: true,
        estimatedCost: result.meta.usage.estimatedCost,
      });
      logger?.debug(
        {
          provider: provider.name,
          model: provider.model,
          operation,
          durationMs: timer.elapsedMs(),
          totalTokens: result.meta.usage.totalTokens,
        },
        'AI call completed',
      );
      return result;
    } catch (error) {
      usageRecorder?.record({ provider: provider.name, operation, success: false });
      logger?.error(
        { provider: provider.name, operation, durationMs: timer.elapsedMs(), err: error },
        'AI call failed',
      );
      throw error instanceof AppError
        ? error
        : new LlmProviderError(provider.name, 'The AI provider failed.', { cause: error });
    }
  };

  return {
    name: provider.name,
    model: provider.model,
    generate: (request) => run('generate', () => provider.generate(request)),
    summarize: (request) => run('summarize', () => provider.summarize(request)),
    classify: (request) => run('classify', () => provider.classify(request)),
    translate: (request) => run('translate', () => provider.translate(request)),
    embed: (request) => run('embed', () => provider.embed(request)),
  };
}
