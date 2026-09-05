import { describe, expect, it } from 'vitest';

import type { AnalyticsRange } from '@trendhunter/types';

import {
  ANALYTICS_RANGE_BUCKET_HOURS,
  ANALYTICS_RANGE_HOURS,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  bucketIndexFor,
  bucketStarts,
  daysBetween,
  elapsedMs,
  hoursBetween,
  minutesBetween,
  parseIso,
  previousWindow,
  subtractHours,
  subtractMinutes,
  toIso,
  windowForRange,
} from '../src/time';

const NOW = new Date('2026-03-15T12:00:00.000Z');
const RANGES: readonly AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

describe('millisecond constants', () => {
  it('are consistent with one another', () => {
    expect(MILLISECONDS_PER_HOUR).toBe(MILLISECONDS_PER_MINUTE * 60);
    expect(MILLISECONDS_PER_DAY).toBe(MILLISECONDS_PER_HOUR * 24);
  });
});

describe('toIso and parseIso', () => {
  it('round-trip an instant', () => {
    expect(parseIso(toIso(NOW))?.getTime()).toBe(NOW.getTime());
  });

  it('emit a UTC ISO 8601 string', () => {
    expect(toIso(NOW)).toBe('2026-03-15T12:00:00.000Z');
  });

  it('return null instead of an Invalid Date', () => {
    expect(parseIso('not a date')).toBeNull();
    expect(parseIso('')).toBeNull();
    expect(parseIso('2026-13-45T99:99:99Z')).toBeNull();
  });
});

describe('differences', () => {
  it('measure forwards as positive and backwards as negative', () => {
    const later = new Date(NOW.getTime() + 90 * MILLISECONDS_PER_MINUTE);
    expect(minutesBetween(NOW, later)).toBe(90);
    expect(hoursBetween(NOW, later)).toBe(1.5);
    expect(minutesBetween(later, NOW)).toBe(-90);
  });

  it('measure days as fractions', () => {
    const later = new Date(NOW.getTime() + 36 * MILLISECONDS_PER_HOUR);
    expect(daysBetween(NOW, later)).toBe(1.5);
  });

  it('are zero for the same instant', () => {
    expect(hoursBetween(NOW, NOW)).toBe(0);
    expect(daysBetween(NOW, NOW)).toBe(0);
  });
});

describe('subtractHours and subtractMinutes', () => {
  it('move backwards without mutating the input', () => {
    const result = subtractHours(NOW, 6);
    expect(result.toISOString()).toBe('2026-03-15T06:00:00.000Z');
    expect(NOW.toISOString()).toBe('2026-03-15T12:00:00.000Z');
  });

  it('accept fractional and negative amounts', () => {
    expect(subtractMinutes(NOW, 30).toISOString()).toBe('2026-03-15T11:30:00.000Z');
    expect(subtractHours(NOW, -1).toISOString()).toBe('2026-03-15T13:00:00.000Z');
  });
});

describe('analytics range tables', () => {
  it('cover every range', () => {
    for (const range of RANGES) {
      expect(ANALYTICS_RANGE_HOURS[range]).toBeGreaterThan(0);
      expect(ANALYTICS_RANGE_BUCKET_HOURS[range]).toBeGreaterThan(0);
    }
  });

  it('keep every range between 24 and 90 chart points', () => {
    for (const range of RANGES) {
      const points = ANALYTICS_RANGE_HOURS[range] / ANALYTICS_RANGE_BUCKET_HOURS[range];
      expect(points).toBeGreaterThanOrEqual(24);
      expect(points).toBeLessThanOrEqual(90);
    }
  });
});

describe('windowForRange', () => {
  it('ends at now and starts one range-length earlier', () => {
    const window = windowForRange('7d', NOW);
    expect(window.to).toEqual(NOW);
    expect(hoursBetween(window.from, window.to)).toBe(24 * 7);
  });

  it('produces the documented length for every range', () => {
    for (const range of RANGES) {
      const window = windowForRange(range, NOW);
      expect(hoursBetween(window.from, window.to)).toBe(ANALYTICS_RANGE_HOURS[range]);
    }
  });
});

describe('previousWindow', () => {
  it('abuts the given window and has the same length', () => {
    const window = windowForRange('24h', NOW);
    const previous = previousWindow(window);
    expect(previous.to).toEqual(window.from);
    expect(previous.to.getTime() - previous.from.getTime()).toBe(
      window.to.getTime() - window.from.getTime(),
    );
  });

  it('handles a zero-length window without moving', () => {
    const previous = previousWindow({ from: NOW, to: NOW });
    expect(previous.from).toEqual(NOW);
    expect(previous.to).toEqual(NOW);
  });

  it('chains: the window before the previous one abuts it too', () => {
    const window = windowForRange('7d', NOW);
    const first = previousWindow(window);
    const second = previousWindow(first);
    expect(second.to).toEqual(first.from);
  });
});

describe('bucketStarts', () => {
  it('produces one aligned bucket per hour across a 24h window', () => {
    const window = { from: new Date('2026-03-15T00:00:00Z'), to: new Date('2026-03-16T00:00:00Z') };
    const buckets = bucketStarts(window, 1);
    expect(buckets).toHaveLength(24);
    expect(buckets[0]?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(buckets[23]?.toISOString()).toBe('2026-03-15T23:00:00.000Z');
  });

  it('aligns the first edge below an unaligned window start', () => {
    const window = { from: new Date('2026-03-15T00:30:00Z'), to: new Date('2026-03-15T03:00:00Z') };
    const buckets = bucketStarts(window, 1);
    expect(buckets.map((bucket) => bucket.toISOString())).toEqual([
      '2026-03-15T00:00:00.000Z',
      '2026-03-15T01:00:00.000Z',
      '2026-03-15T02:00:00.000Z',
    ]);
  });

  it('excludes the closing edge so buckets never overlap the next window', () => {
    const window = { from: new Date('2026-03-15T00:00:00Z'), to: new Date('2026-03-15T02:00:00Z') };
    expect(bucketStarts(window, 1)).toHaveLength(2);
  });

  it('returns no buckets for a zero-length or inverted window', () => {
    expect(bucketStarts({ from: NOW, to: NOW }, 1)).toEqual([]);
    expect(bucketStarts({ from: NOW, to: subtractHours(NOW, 5) }, 1)).toEqual([]);
  });

  it('treats a non-positive bucket width as one hour', () => {
    const window = { from: new Date('2026-03-15T00:00:00Z'), to: new Date('2026-03-15T03:00:00Z') };
    expect(bucketStarts(window, 0)).toHaveLength(3);
    expect(bucketStarts(window, -5)).toHaveLength(3);
  });

  it('is stable when `now` drifts inside a bucket', () => {
    const early = bucketStarts(
      { from: new Date('2026-03-15T00:10:00Z'), to: new Date('2026-03-15T05:10:00Z') },
      1,
    );
    const late = bucketStarts(
      { from: new Date('2026-03-15T00:50:00Z'), to: new Date('2026-03-15T05:50:00Z') },
      1,
    );
    expect(early.slice(0, 5).map((d) => d.toISOString())).toEqual(
      late.slice(0, 5).map((d) => d.toISOString()),
    );
  });

  it('produces the documented number of points for each analytics range', () => {
    for (const range of RANGES) {
      const window = windowForRange(range, new Date('2026-03-15T00:00:00Z'));
      const buckets = bucketStarts(window, ANALYTICS_RANGE_BUCKET_HOURS[range]);
      expect(buckets.length).toBe(ANALYTICS_RANGE_HOURS[range] / ANALYTICS_RANGE_BUCKET_HOURS[range]);
    }
  });
});

describe('bucketIndexFor', () => {
  const buckets = bucketStarts(
    { from: new Date('2026-03-15T00:00:00Z'), to: new Date('2026-03-15T04:00:00Z') },
    1,
  );

  it('places a timestamp in the bucket that contains it', () => {
    expect(bucketIndexFor(new Date('2026-03-15T02:30:00Z'), buckets, 1)).toBe(2);
  });

  it('assigns a timestamp on a bucket edge to that bucket, not the previous one', () => {
    expect(bucketIndexFor(new Date('2026-03-15T00:00:00Z'), buckets, 1)).toBe(0);
    expect(bucketIndexFor(new Date('2026-03-15T03:00:00Z'), buckets, 1)).toBe(3);
  });

  it('returns -1 before the first bucket and after the last', () => {
    expect(bucketIndexFor(new Date('2026-03-14T23:59:59Z'), buckets, 1)).toBe(-1);
    expect(bucketIndexFor(new Date('2026-03-15T04:00:00Z'), buckets, 1)).toBe(-1);
  });

  it('returns -1 when there are no buckets', () => {
    expect(bucketIndexFor(NOW, [], 1)).toBe(-1);
  });

  it('covers every bucket exactly once across its own window', () => {
    const seen = buckets.map((bucket) => bucketIndexFor(bucket, buckets, 1));
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('elapsedMs', () => {
  it('measures forward time', () => {
    expect(elapsedMs(subtractHours(NOW, 2), NOW)).toBe(2 * MILLISECONDS_PER_HOUR);
  });

  it('never goes negative when the clock appears to move backwards', () => {
    expect(elapsedMs(NOW, subtractHours(NOW, 2))).toBe(0);
  });
});
