import { characterCount } from '@trendhunter/shared';
import type {
  ClassificationResult,
  EmbedOutput,
  GenerateRequest,
  GeneratedPost,
  GeneratedThread,
  LlmCallMeta,
  LlmProvider,
  LlmResult,
  TranslationOutput,
} from '@trendhunter/types';

/**
 * A deterministic stand-in for `@trendhunter/ai`.
 *
 * It answers from the brief it is given: the text it returns is derived from a
 * hash of `context.topicSummary`, so a different angle or a different rewrite
 * instruction really does produce different content — which is what makes the
 * regeneration and rewrite guarantees testable without a network call.
 */

const WORDS_EN: readonly string[] = [
  'agents',
  'latency',
  'budget',
  'pipeline',
  'vector',
  'tokens',
  'margin',
  'fallback',
  'retries',
  'throughput',
  'schema',
  'workloads',
];

const WORDS_AR: readonly string[] = [
  'وكلاء',
  'زمن',
  'ميزانية',
  'خط',
  'متجه',
  'رموز',
  'هامش',
  'بديل',
  'محاولات',
  'إنتاجية',
  'مخطط',
  'أحمال',
];

export interface FakeProviderOptions {
  readonly name?: string;
  readonly model?: string;
  /** Share of the requested budget the fake fills. */
  readonly fill?: number;
  /** Ignore the brief and always answer with this text. */
  readonly constantContent?: string;
  /** Raw value returned instead of a well-formed one, to simulate a bad adapter. */
  readonly malformedValue?: unknown;
  /** Throw a raw, unwrapped error, as a badly written adapter would. */
  readonly throwRaw?: boolean;
  /** Characters per thread post, before the service splits anything oversized. */
  readonly threadPostLength?: number;
}

export interface FakeProvider extends LlmProvider {
  /** Every request the fake was given, in order. */
  readonly requests: GenerateRequest[];
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const name = options.name ?? 'fake';
  const model = options.model ?? 'fake-1';
  const fill = options.fill ?? 0.9;
  const requests: GenerateRequest[] = [];

  const meta: LlmCallMeta = {
    provider: name,
    model,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0 },
    durationMs: 1,
  };

  return {
    name,
    model,
    requests,
    generate(request: GenerateRequest): Promise<LlmResult<GeneratedPost | GeneratedThread>> {
      requests.push(request);
      if (options.throwRaw === true) {
        throw new Error('raw vendor failure');
      }
      if (options.malformedValue !== undefined) {
        return Promise.resolve({ value: options.malformedValue as GeneratedPost, meta });
      }
      const brief = request.context.topicSummary ?? request.context.topicName;
      const words = request.language === 'AR' ? WORDS_AR : WORDS_EN;
      const seed = seedOf(brief);

      if (request.kind === 'X_THREAD') {
        const length = request.threadLength ?? 3;
        const target = options.threadPostLength ?? 200;
        const posts: GeneratedPost[] = [];
        for (let index = 0; index < length; index += 1) {
          const content =
            options.constantContent ?? buildText(seed + index * 31, target, words);
          posts.push({ title: null, content, characterCount: characterCount(content) });
        }
        return Promise.resolve({ value: { title: 'Fake thread', posts }, meta });
      }

      const target = Math.max(1, Math.round((request.maxCharacters ?? 280) * fill));
      const content = options.constantContent ?? buildText(seed, target, words);
      return Promise.resolve({
        value: { title: null, content, characterCount: characterCount(content) },
        meta,
      });
    },
    summarize(): Promise<LlmResult<string>> {
      return Promise.resolve({ value: 'summary', meta });
    },
    classify(): Promise<LlmResult<ClassificationResult>> {
      return Promise.resolve({
        value: { label: 'ai', confidence: 1, matchedLabels: [{ label: 'ai', confidence: 1 }] },
        meta,
      });
    },
    translate(): Promise<LlmResult<TranslationOutput>> {
      return Promise.resolve({
        value: { translatedText: 'ترجمة', preservedTerms: [], explanation: null },
        meta,
      });
    },
    embed(): Promise<LlmResult<EmbedOutput>> {
      return Promise.resolve({ value: { vectors: [[0, 1]], dimensions: 2, model }, meta });
    },
  };
}

/** Stable, order-sensitive hash of the brief. */
function seedOf(brief: string): number {
  let seed = 7;
  for (let index = 0; index < brief.length; index += 1) {
    seed = (seed * 31 + brief.charCodeAt(index)) % 100_003;
  }
  return seed;
}

/**
 * Fills up to, and never past, `target` characters with whole sentences.
 *
 * The opening sentence carries the seed, so two different briefs never produce
 * the same text — which is what lets the regeneration and idea-distinctness
 * tests mean something.
 */
function buildText(seed: number, target: number, words: readonly string[]): string {
  const lead = `${words[seed % words.length] ?? 'signal'} ${seed}.`;
  if (characterCount(lead) > target) {
    return Array.from(lead).slice(0, Math.max(1, target)).join('');
  }
  let text = lead;
  for (let index = 0; index < 200; index += 1) {
    const candidate = `${text} ${sentence(seed + index, words, 5 + (index % 4))}`;
    if (characterCount(candidate) > target) break;
    text = candidate;
  }
  return text;
}

function sentence(seed: number, words: readonly string[], wordCount: number): string {
  const parts: string[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    parts.push(words[(seed * 7 + index * 13) % words.length] ?? 'signal');
  }
  const joined = parts.join(' ');
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}
