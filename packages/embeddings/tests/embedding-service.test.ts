import { EMBEDDING_INPUT_CHARACTER_LIMIT, ValidationError } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  DeterministicEmbeddingProvider,
  EmbeddingService,
  InvalidEmbeddingError,
} from '../src/index';

import { createRecordingLogger, createSleepRecorder, FakeEmbeddingProvider } from './fakes';

/** Distinct per text, so alignment failures cannot pass unnoticed. */
function vectorForText(text: string, dimensions: number): number[] {
  const seed = text.length / 100;
  return Array.from({ length: dimensions }, (_value, index) => seed + index / 1000);
}

describe('EmbeddingService.embedTexts', () => {
  it('keeps results aligned with input indices and skips blank inputs', async () => {
    const provider = new FakeEmbeddingProvider({ vectorFor: vectorForText });
    const service = new EmbeddingService(provider, createRecordingLogger());

    const texts = ['alpha', '', 'beta text', '   ', 'gamma'];
    const results = await service.embedTexts(texts);

    expect(results).toHaveLength(5);
    expect(results[1]).toBeNull();
    expect(results[3]).toBeNull();
    expect(results[0]).toEqual(vectorForText('alpha', provider.dimensions));
    expect(results[2]).toEqual(vectorForText('beta text', provider.dimensions));
    expect(results[4]).toEqual(vectorForText('gamma', provider.dimensions));
    expect(provider.calls).toEqual([['alpha', 'beta text', 'gamma']]);
  });

  it('never calls the provider when every input is blank', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider, createRecordingLogger());

    expect(await service.embedTexts(['', '  ', '\n'])).toEqual([null, null, null]);
    expect(provider.calls).toEqual([]);
  });

  it('returns an empty array for an empty input array', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider, createRecordingLogger());

    expect(await service.embedTexts([])).toEqual([]);
    expect(provider.calls).toEqual([]);
  });

  it('splits the work into batches of the configured size', async () => {
    const provider = new FakeEmbeddingProvider({ vectorFor: vectorForText });
    const service = new EmbeddingService(provider, createRecordingLogger(), { batchSize: 2 });

    const texts = ['one', '', 'two', 'three', 'four', '   ', 'five'];
    const results = await service.embedTexts(texts);

    expect(provider.calls).toEqual([['one', 'two'], ['three', 'four'], ['five']]);
    expect(results.filter((vector) => vector === null)).toHaveLength(2);
    expect(results[6]).toEqual(vectorForText('five', provider.dimensions));
  });

  it('truncates each input to the provider character budget', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider, createRecordingLogger());

    await service.embedTexts([`  ${'x'.repeat(EMBEDDING_INPUT_CHARACTER_LIMIT + 500)}  `]);

    expect(provider.calls[0]?.[0]).toHaveLength(EMBEDDING_INPUT_CHARACTER_LIMIT);
  });

  it('retries a failed batch with exponential backoff and then succeeds', async () => {
    const provider = new FakeEmbeddingProvider({ failures: 2, vectorFor: vectorForText });
    const logger = createRecordingLogger();
    const sleeper = createSleepRecorder();
    const service = new EmbeddingService(provider, logger, {
      maxAttempts: 3,
      initialBackoffMs: 50,
      sleep: sleeper.sleep,
    });

    const results = await service.embedTexts(['alpha']);

    expect(results[0]).toEqual(vectorForText('alpha', provider.dimensions));
    expect(provider.calls).toHaveLength(3);
    expect(sleeper.waits).toEqual([50, 100]);
    expect(logger.warnings).toHaveLength(2);
  });

  it('caps the backoff at the configured ceiling', async () => {
    const provider = new FakeEmbeddingProvider({ failures: 3, vectorFor: vectorForText });
    const sleeper = createSleepRecorder();
    const service = new EmbeddingService(provider, createRecordingLogger(), {
      maxAttempts: 4,
      initialBackoffMs: 100,
      maxBackoffMs: 150,
      sleep: sleeper.sleep,
    });

    await service.embedTexts(['alpha']);

    expect(sleeper.waits).toEqual([100, 150, 150]);
  });

  it('gives up after the attempt budget and rethrows the provider error', async () => {
    const provider = new FakeEmbeddingProvider({ failures: 10 });
    const sleeper = createSleepRecorder();
    const service = new EmbeddingService(provider, createRecordingLogger(), {
      maxAttempts: 2,
      initialBackoffMs: 10,
      sleep: sleeper.sleep,
    });

    await expect(service.embedTexts(['alpha'])).rejects.toThrow('upstream unavailable');
    expect(provider.calls).toHaveLength(2);
    expect(sleeper.waits).toEqual([10]);
  });

  it('rejects a vector of the wrong width without retrying it', async () => {
    const provider = new FakeEmbeddingProvider({
      dimensions: 4,
      vectorFor: () => [0.1, 0.2],
    });
    const sleeper = createSleepRecorder();
    const service = new EmbeddingService(provider, createRecordingLogger(), {
      maxAttempts: 3,
      sleep: sleeper.sleep,
    });

    await expect(service.embedTexts(['alpha'])).rejects.toBeInstanceOf(InvalidEmbeddingError);
    expect(provider.calls).toHaveLength(1);
    expect(sleeper.waits).toEqual([]);
  });

  it('rejects a vector containing a non-finite component', async () => {
    const provider = new FakeEmbeddingProvider({
      dimensions: 3,
      vectorFor: () => [0.1, Number.NaN, 0.3],
    });
    const service = new EmbeddingService(provider, createRecordingLogger());

    await expect(service.embedTexts(['alpha'])).rejects.toBeInstanceOf(InvalidEmbeddingError);
  });

  it('rejects an infinite component', async () => {
    const provider = new FakeEmbeddingProvider({
      dimensions: 2,
      vectorFor: () => [1, Number.POSITIVE_INFINITY],
    });
    const service = new EmbeddingService(provider, createRecordingLogger());

    await expect(service.embedTexts(['alpha'])).rejects.toBeInstanceOf(InvalidEmbeddingError);
  });

  it('rejects an answer with fewer vectors than texts', async () => {
    const provider = new FakeEmbeddingProvider({ dropVectors: 1 });
    const service = new EmbeddingService(provider, createRecordingLogger());

    await expect(service.embedTexts(['alpha', 'beta'])).rejects.toBeInstanceOf(
      InvalidEmbeddingError,
    );
  });

  it('rejects an answer whose reported width disagrees with the provider', async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, reportedDimensions: 8 });
    const service = new EmbeddingService(provider, createRecordingLogger());

    await expect(service.embedTexts(['alpha'])).rejects.toBeInstanceOf(InvalidEmbeddingError);
  });

  it('works end to end against the deterministic provider', async () => {
    const provider = new DeterministicEmbeddingProvider({ dimensions: 32 });
    const service = new EmbeddingService(provider, createRecordingLogger(), { batchSize: 2 });

    const results = await service.embedTexts([
      'الذكاء الاصطناعي والشركات الناشئة',
      '',
      'open source language models',
    ]);

    expect(service.dimensions).toBe(32);
    expect(results[0]).toHaveLength(32);
    expect(results[1]).toBeNull();
    expect(results[2]).toHaveLength(32);
  });
});

describe('EmbeddingService.embedOne', () => {
  it('returns the vector for a single text', async () => {
    const provider = new FakeEmbeddingProvider({ vectorFor: vectorForText });
    const service = new EmbeddingService(provider, createRecordingLogger());

    expect(await service.embedOne('alpha')).toEqual(vectorForText('alpha', provider.dimensions));
  });

  it('refuses a blank text instead of inventing a vector', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider, createRecordingLogger());

    await expect(service.embedOne('   ')).rejects.toBeInstanceOf(ValidationError);
    expect(provider.calls).toEqual([]);
  });
});
