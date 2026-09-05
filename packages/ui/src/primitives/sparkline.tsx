'use client';

import { Line, LineChart, ResponsiveContainer } from 'recharts';

export interface SparklineProps {
  readonly values: readonly number[];
  /** CSS colour; defaults to the first series slot. */
  readonly color?: string;
  readonly height?: number;
  /** Describes the shape for a reader who cannot see it. */
  readonly label: string;
}

/**
 * A trend line with no axes, no grid and no tooltip.
 *
 * It is a shape, not a chart: it says "rising" or "flat" next to a number that
 * says how much. Anything that invites a reader to measure a value off it —
 * an axis, a hover readout — is a promise five pixels of height cannot keep.
 * The accessible name carries the direction instead.
 */
export function Sparkline({ values, color, height = 32, label }: SparklineProps) {
  const data = values.map((value, index) => ({ index, value }));

  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color ?? 'var(--chart-1)'}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
