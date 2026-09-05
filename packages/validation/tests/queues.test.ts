import { describe, expect, it } from 'vitest';

import {
  QUEUE_PAYLOAD_SCHEMAS,
  clusteringJobPayloadSchema,
  collectJobPayloadSchema,
  embeddingsJobPayloadSchema,
  maintenanceJobPayloadSchema,
  normalizeJobPayloadSchema,
  translationJobPayloadSchema,
} from '../src';
import { ALL_QUEUE_NAMES } from '@trendhunter/types';

/**
 * A queue payload is untrusted input: it was written by a different process,
 * possibly a different release, and it may have been sitting in Redis across a
 * deploy. These tests pin the shapes a worker will accept.
 */

describe('QUEUE_PAYLOAD_SCHEMAS', () => {
  it('covers every queue the platform declares', () => {
    // A queue without a schema would be a worker parsing nothing, which is the
    // exact failure this map exists to prevent.
    for (const queue of ALL_QUEUE_NAMES) {
      expect(QUEUE_PAYLOAD_SCHEMAS).toHaveProperty(queue);
    }
    expect(Object.keys(QUEUE_PAYLOAD_SCHEMAS).length).toBe(ALL_QUEUE_NAMES.length);
  });
});

describe('collectJobPayloadSchema', () => {
  const valid = {
    scanRunId: 'scan1',
    sourceId: 'src1',
    source: 'REDDIT',
    limit: 50,
    since: null,
  };

  it('accepts a well-formed payload', () => {
    expect(collectJobPayloadSchema.parse(valid)).toEqual(valid);
  });

  it('accepts an ISO since value', () => {
    const parsed = collectJobPayloadSchema.parse({ ...valid, since: '2026-01-01T00:00:00.000Z' });
    expect(parsed.since).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuses an unknown source', () => {
    expect(collectJobPayloadSchema.safeParse({ ...valid, source: 'FACEBOOK' }).success).toBe(false);
  });

  it('refuses a limit above the collection cap', () => {
    // Without this, a crafted or stale job could ask a connector for an
    // unbounded page and blow through a provider rate limit.
    expect(collectJobPayloadSchema.safeParse({ ...valid, limit: 100_000 }).success).toBe(false);
  });

  it('refuses a missing field rather than defaulting it', () => {
    expect(collectJobPayloadSchema.safeParse({ ...valid, scanRunId: undefined }).success).toBe(
      false,
    );
  });

  it('refuses a non-integer limit', () => {
    expect(collectJobPayloadSchema.safeParse({ ...valid, limit: 12.5 }).success).toBe(false);
  });
});

describe('normalizeJobPayloadSchema', () => {
  it('requires at least one raw item', () => {
    expect(
      normalizeJobPayloadSchema.safeParse({ scanRunId: 's1', source: 'X', rawItemIds: [] }).success,
    ).toBe(false);
  });

  it('bounds the number of ids in one payload', () => {
    const ids = Array.from({ length: 201 }, (_, index) => `raw${index}`);
    expect(
      normalizeJobPayloadSchema.safeParse({ scanRunId: 's1', source: 'X', rawItemIds: ids }).success,
    ).toBe(false);
  });
});

describe('embeddingsJobPayloadSchema', () => {
  it('requires at least one record overall', () => {
    expect(
      embeddingsJobPayloadSchema.safeParse({ scanRunId: null, postIds: [], commentIds: [] }).success,
    ).toBe(false);
  });

  it('accepts comments only', () => {
    expect(
      embeddingsJobPayloadSchema.safeParse({ scanRunId: null, postIds: [], commentIds: ['c1'] })
        .success,
    ).toBe(true);
  });
});

describe('clusteringJobPayloadSchema', () => {
  it('requires post ids', () => {
    expect(clusteringJobPayloadSchema.safeParse({ scanRunId: null, postIds: [] }).success).toBe(
      false,
    );
  });
});

describe('translationJobPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(
      translationJobPayloadSchema.safeParse({
        userId: 'u1',
        targetKind: 'THREAD',
        targetId: 't1',
        mode: 'X_STYLE',
        targetLanguage: 'AR',
      }).success,
    ).toBe(true);
  });

  it('refuses a target kind the worker cannot handle', () => {
    expect(
      translationJobPayloadSchema.safeParse({
        userId: 'u1',
        targetKind: 'FREEFORM',
        targetId: 't1',
        mode: 'X_STYLE',
        targetLanguage: 'AR',
      }).success,
    ).toBe(false);
  });

  it('refuses an unknown translation mode', () => {
    expect(
      translationJobPayloadSchema.safeParse({
        userId: 'u1',
        targetKind: 'POST',
        targetId: 't1',
        mode: 'PIRATE',
        targetLanguage: 'AR',
      }).success,
    ).toBe(false);
  });
});

describe('maintenanceJobPayloadSchema', () => {
  it('accepts each known task', () => {
    for (const task of [
      'prune-raw-items',
      'prune-job-runs',
      'refresh-source-counters',
      'heartbeat',
    ]) {
      expect(maintenanceJobPayloadSchema.safeParse({ task }).success).toBe(true);
    }
  });

  it('refuses an unknown task', () => {
    expect(maintenanceJobPayloadSchema.safeParse({ task: 'rm -rf' }).success).toBe(false);
  });
});
