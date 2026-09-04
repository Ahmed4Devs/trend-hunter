import type { AnalyticsRange, IsoDateTime } from '@trendhunter/types';

/**
 * Time helpers.
 *
 * Every function takes an explicit `now` so that scoring, bucketing and report
 * generation are deterministic under test. Nothing in the domain layer is
 * allowed to read the wall clock implicitly.
 */

export const MILLISECONDS_PER_MINUTE = 60_000;
export const MILLISECONDS_PER_HOUR = 3_600_000;
export const MILLISECONDS_PER_DAY = 86_400_000;

export function toIso(date: Date): IsoDateTime {
  return date.toISOString();
}

/** Parses an ISO string, returning `null` rather than an Invalid Date. */
export function parseIso(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MILLISECONDS_PER_MINUTE;
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MILLISECONDS_PER_HOUR;
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY;
}

export function subtractHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * MILLISECONDS_PER_HOUR);
}

export function subtractMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * MILLISECONDS_PER_MINUTE);
}

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/** Duration of each analytics range, in hours. */
export const ANALYTICS_RANGE_HOURS: Readonly<Record<AnalyticsRange, number>> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
};

/**
 * Bucket width used when charting a range, chosen so every range renders
 * between 24 and 90 points — dense enough to show shape, sparse enough to stay
 * readable on a dashboard card.
 */
export const ANALYTICS_RANGE_BUCKET_HOURS: Readonly<Record<AnalyticsRange, number>> = {
  '24h': 1,
  '7d': 6,
  '30d': 24,
  '90d': 24,
};

export function windowForRange(range: AnalyticsRange, now: Date): TimeWindow {
  return { from: subtractHours(now, ANALYTICS_RANGE_HOURS[range]), to: now };
}

/** The window of equal length immediately preceding `window`. */
export function previousWindow(window: TimeWindow): TimeWindow {
  const length = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - length), to: window.from };
}

/**
 * Generates the left edge of every bucket in `window`, aligned to the bucket
 * width so that two calls with a slightly different `now` still produce
 * comparable series.
 */
export function bucketStarts(window: TimeWindow, bucketHours: number): Date[] {
  const widthMs = Math.max(1, bucketHours) * MILLISECONDS_PER_HOUR;
  const firstEdge = Math.floor(window.from.getTime() / widthMs) * widthMs;
  const buckets: Date[] = [];
  for (let edge = firstEdge; edge < window.to.getTime(); edge += widthMs) {
    buckets.push(new Date(edge));
  }
  return buckets;
}

/** Index of the bucket a timestamp belongs to, or `-1` when out of range. */
export function bucketIndexFor(
  timestamp: Date,
  buckets: readonly Date[],
  bucketHours: number,
): number {
  const first = buckets[0];
  if (!first) return -1;
  const widthMs = Math.max(1, bucketHours) * MILLISECONDS_PER_HOUR;
  const index = Math.floor((timestamp.getTime() - first.getTime()) / widthMs);
  return index >= 0 && index < buckets.length ? index : -1;
}

/** Milliseconds elapsed since `start`, never negative. */
export function elapsedMs(start: Date, now: Date): number {
  return Math.max(0, now.getTime() - start.getTime());
}
