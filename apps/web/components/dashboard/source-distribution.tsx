'use client';

import type { SourceDistributionSlice } from '@trendhunter/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartFrame,
  ChartTooltip,
  EmptyState,
  SOURCE_COLOR,
} from '@trendhunter/ui';
import { PieChartIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Pie, PieChart, Tooltip, type TooltipContentProps, type TooltipValueType } from 'recharts';

export interface SourceDistributionProps {
  readonly slices: readonly SourceDistributionSlice[];
  readonly total: number;
}

/**
 * The source mix.
 *
 * A donut is defensible here for one reason only: the slices are parts of one
 * whole and there are six of them at most. The legend beside it carries the
 * count and the share as text, which is what makes the chart readable for a
 * reader who cannot separate two of the hues — and which discharges the
 * contrast relief the palette's light-mode steps require.
 *
 * Slices are drawn in a fixed source order rather than by size, so a source
 * keeps the same colour and the same neighbours from one range to the next.
 */
export function SourceDistribution({ slices, total }: SourceDistributionProps) {
  const t = useTranslations('dashboard.sources');
  const format = useFormatter();

  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState icon={<PieChartIcon className="size-5" />} title={t('empty')} />
        </CardContent>
      </Card>
    );
  }

  const data = slices.map((slice) => ({
    source: slice.source,
    count: slice.count,
    percentage: slice.percentage,
    fill: SOURCE_COLOR[slice.source],
  }));

  return (
    <Card>
      <CardHeader className="flex-col items-start">
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { count: format.number(total) })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
        <ChartFrame height={200}>
          <PieChart>
            <Pie
              data={[...data]}
              dataKey="count"
              nameKey="source"
              innerRadius="58%"
              outerRadius="88%"
              // A hairline of surface between slices, so two adjacent fills
              // never touch and read as one shape.
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={false}
              content={({
                active,
                payload,
              }: TooltipContentProps<TooltipValueType, string | number>) => {
                const entry = payload[0]?.payload as (typeof data)[number] | undefined;
                if (!active || entry === undefined) return null;
                return (
                  <ChartTooltip
                    label={entry.source}
                    entries={[
                      {
                        name: t('posts'),
                        value: format.number(entry.count),
                        color: entry.fill,
                      },
                    ]}
                  />
                );
              }}
            />
          </PieChart>
        </ChartFrame>

        {/* The same numbers as text. This is the table view the palette's
            light-mode contrast warning requires, and it is also the only way
            the panel is usable on a screen reader. */}
        <ul aria-label={t('table')} className="space-y-2">
          {data.map((slice) => (
            <li key={slice.source} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.fill }}
              />
              <span className="flex-1 truncate font-medium">{slice.source}</span>
              <span className="tabular text-muted-foreground">{format.number(slice.count)}</span>
              <span className="tabular w-14 text-end font-medium">
                {format.number(slice.percentage / 100, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
