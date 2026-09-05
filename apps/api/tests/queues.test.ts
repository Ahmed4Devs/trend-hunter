import { QUEUE_NAMES } from '@trendhunter/types';
import { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { createQueueProducers } from '../src/queues';

/**
 * BullMQ builds its own Redis keys by joining segments with a colon, so it
 * rejects a colon in a queue name or in a custom job id — at run time, when the
 * job is added, with a message that names neither the caller nor the id.
 *
 * That failure reached the interface once already: "Scan now" answered 500
 * while every other test passed, because nothing here had ever added a job.
 * These tests add them, against a fake queue, and assert the ids are legal.
 */

vi.mock('bullmq', () => ({
  Queue: vi.fn(),
}));

interface AddedJob {
  readonly queue: string;
  readonly name: string;
  readonly jobId: string | undefined;
}

/** Records what would have been enqueued, without a Redis anywhere. */
function recordingProducers() {
  const added: AddedJob[] = [];

  // A `function`, not an arrow: this stands in for a class, and an arrow
  // function cannot be called with `new`.
  vi.mocked(Queue).mockImplementation(function (name: string) {
    return {
      add: (jobName: string, _payload: unknown, options?: { jobId?: string }) => {
        added.push({ queue: name, name: jobName, jobId: options?.jobId });
        return Promise.resolve({ id: options?.jobId ?? '1' });
      },
    } as unknown as Queue;
  });

  // The connection is never touched: every method used here is on the queue.
  return { added, producers: createQueueProducers({} as never) };
}

/** What BullMQ itself rejects. */
function isLegalIdentifier(value: string): boolean {
  return !value.includes(':');
}

describe('queue producers', () => {
  it('never builds a job id containing a colon', async () => {
    const { added, producers } = recordingProducers();

    await producers.enqueueScan({
      scanRunId: 'scan_123',
      sources: [
        { id: 'src_1', kind: 'X' },
        { id: 'src_2', kind: 'HACKERNEWS' },
      ],
      limit: 25,
      since: null,
    });


    await producers.enqueueTranslation({
      userId: 'user_1',
      targetKind: 'POST',
      targetId: 'post_1',
      targetLanguage: 'AR',
      mode: 'X_STYLE',
    });

    await producers.enqueueReport({ userId: 'user_1', reportId: 'report_1' });

    expect(added.length).toBeGreaterThan(0);
    for (const job of added) {
      expect(job.jobId === undefined || isLegalIdentifier(job.jobId), job.queue).toBe(true);
    }
  });

  it('never declares a queue name containing a colon', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(isLegalIdentifier(name), name).toBe(true);
    }
  });

  it('gives every source in a scan its own job', async () => {
    const { added, producers } = recordingProducers();

    await producers.enqueueScan({
      scanRunId: 'scan_123',
      sources: [
        { id: 'src_1', kind: 'X' },
        { id: 'src_2', kind: 'REDDIT' },
      ],
      limit: 25,
      since: null,
    });

    // One job per source, on that source's own queue, so a slow provider
    // blocks only its own collection.
    expect(added).toHaveLength(2);
    expect(new Set(added.map((job) => job.queue)).size).toBe(2);
    expect(new Set(added.map((job) => job.jobId)).size).toBe(2);
  });
});
