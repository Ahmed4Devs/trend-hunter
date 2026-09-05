import type { EmbedOutput, EmbedRequest, EmbeddingProvider, LlmResult } from '@trendhunter/types';

import type { EmbeddingLogger } from '../src/index';

export interface FakeEmbeddingProviderOptions {
  readonly dimensions?: number;
  /** Width reported in the payload, when it must differ from `dimensions`. */
  readonly reportedDimensions?: number;
  /** Builds the vector for one text; defaults to a valid constant vector. */
  readonly vectorFor?: (text: string, dimensions: number) => number[];
  /** Drops this many vectors off the end of every answer. */
  readonly dropVectors?: number;
  /** Number of leading calls that reject before the provider starts working. */
  readonly failures?: number;
}

/** Records what it was asked and answers exactly as configured. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake';
  readonly model = 'fake-v1';
  readonly dimensions: number;
  readonly calls: string[][] = [];

  private readonly options: FakeEmbeddingProviderOptions;
  private remainingFailures: number;

  constructor(options: FakeEmbeddingProviderOptions = {}) {
    this.options = options;
    this.dimensions = options.dimensions ?? 4;
    this.remainingFailures = options.failures ?? 0;
  }

  embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>> {
    this.calls.push([...request.texts]);

    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      return Promise.reject(new Error('upstream unavailable'));
    }

    const build =
      this.options.vectorFor ??
      ((_text: string, dimensions: number) => new Array<number>(dimensions).fill(0.5));
    const vectors = request.texts.map((text) => build(text, this.dimensions));
    const dropped = this.options.dropVectors ?? 0;

    return Promise.resolve({
      value: {
        vectors: dropped > 0 ? vectors.slice(0, Math.max(0, vectors.length - dropped)) : vectors,
        dimensions: this.options.reportedDimensions ?? this.dimensions,
        model: this.model,
      },
      meta: {
        provider: this.name,
        model: this.model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        durationMs: 0,
      },
    });
  }
}

export interface RecordedLog {
  readonly context: Record<string, unknown>;
  readonly message: string;
}

export interface RecordingLogger extends EmbeddingLogger {
  readonly debugs: RecordedLog[];
  readonly warnings: RecordedLog[];
}

export function createRecordingLogger(): RecordingLogger {
  const debugs: RecordedLog[] = [];
  const warnings: RecordedLog[] = [];
  return {
    debugs,
    warnings,
    debug(context, message) {
      debugs.push({ context, message });
    },
    warn(context, message) {
      warnings.push({ context, message });
    },
  };
}

export interface SleepRecorder {
  readonly waits: number[];
  readonly sleep: (milliseconds: number) => Promise<void>;
}

/** Replaces the real backoff so retry tests do not spend wall-clock time. */
export function createSleepRecorder(): SleepRecorder {
  const waits: number[] = [];
  return {
    waits,
    sleep: (milliseconds: number) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
  };
}
