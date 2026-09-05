'use client';

import type * as React from 'react';
import { ResponsiveContainer } from 'recharts';

import { cn } from '../lib/cn';

/**
 * Chart plumbing shared by every visualisation in the product.
 *
 * The series palette is six fixed slots defined in the token stylesheet, which
 * a source or a metric is assigned by identity, never by rank. That is what
 * stops a filtered-out series from repainting the ones that remain — the
 * failure mode where a reader watches a line change colour and concludes the
 * data changed.
 */

export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

/**
 * Fixed slot per source.
 *
 * A record rather than an index into the array, so adding a source is a
 * decision rather than a side effect of ordering.
 */
export const SOURCE_COLOR = {
  X: 'var(--source-x)',
  REDDIT: 'var(--source-reddit)',
  HACKERNEWS: 'var(--source-hackernews)',
  RSS: 'var(--source-rss)',
  GITHUB: 'var(--source-github)',
  OTHER: 'var(--source-other)',
} as const;

/** Axis, grid and tooltip colours, read from the theme's own tokens. */
export const CHART_INK = {
  axis: 'var(--muted-foreground)',
  grid: 'var(--border)',
  surface: 'var(--popover)',
} as const;

export interface ChartFrameProps extends React.ComponentProps<'div'> {
  /** Explicit height: a responsive container inside an auto-height parent collapses to nothing. */
  readonly height?: number;
}

export function ChartFrame({ height = 260, className, children, ...props }: ChartFrameProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }} {...props}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

export interface TooltipEntry {
  readonly name: string;
  readonly value: string;
  readonly color: string;
}

export interface ChartTooltipProps {
  readonly label: string;
  readonly entries: readonly TooltipEntry[];
}

/**
 * The tooltip body.
 *
 * Values wear text tokens and the colour appears only in the swatch beside
 * them: a number painted in the series colour is a number that is hard to read
 * and stops being legible the moment the series colour changes.
 */
export function ChartTooltip({ label, entries }: ChartTooltipProps) {
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md">
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="flex-1 truncate text-muted-foreground">{entry.name}</span>
            <span className="tabular font-medium">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
