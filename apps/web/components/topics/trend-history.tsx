'use client';

import type { TrendSnapshot } from '@trendhunter/types';
import { ChartFrame, ChartTooltip, EmptyState } from '@trendhunter/ui';
import { LineChartIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  type TooltipContentProps,
  type TooltipValueType,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * The trend score over time for one topic.
 *
 * A single series, so there is no legend: the card's title already names what
 * the line is, and a legend box for one item is furniture.
 *
 * The y-axis is pinned to 0..100 rather than fitted to the data. The score is
 * an absolute scale, and an auto-fitted axis makes a topic that moved from 41
 * to 43 look identical to one that moved from 10 to 90.
 */
export function TrendHistory({ snapshots }: { readonly snapshots: readonly TrendSnapshot[] }) {
  const t = useTranslations('topics.detail');
  const format = useFormatter();

  if (snapshots.length === 0) {
    return <EmptyState icon={<LineChartIcon className="size-5" />} title={t('noHistory')} />;
  }

  const data = snapshots.map((snapshot) => ({
    ...snapshot,
    label: format.dateTime(new Date(snapshot.recordedAt), { month: 'short', day: 'numeric' }),
  }));

  return (
    <ChartFrame height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="fill-trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
        />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          width={44}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border)' }}
          content={({
            active,
            payload,
            label,
          }: TooltipContentProps<TooltipValueType, string | number>) => {
            if (!active || payload.length === 0) return null;
            const snapshot = payload[0]?.payload as (typeof data)[number] | undefined;
            if (snapshot === undefined) return null;
            return (
              <ChartTooltip
                label={String(label)}
                entries={[
                  {
                    name: t('trend'),
                    color: 'var(--chart-1)',
                    value: format.number(snapshot.trendScore, { maximumFractionDigits: 1 }),
                  },
                  {
                    name: t('velocity'),
                    color: 'var(--chart-2)',
                    value: format.number(snapshot.velocity, { maximumFractionDigits: 1 }),
                  },
                ]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="trendScore"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#fill-trend)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}
