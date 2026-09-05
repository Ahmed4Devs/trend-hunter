'use client';

import type { ActivityBucket, AnalyticsRange } from '@trendhunter/types';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartFrame,
  ChartTooltip,
  EmptyState,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@trendhunter/ui';
import { ActivityIcon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useTransition } from 'react';
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

const RANGES: readonly AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

const SERIES = [
  { key: 'postsCollected', color: 'var(--chart-1)' },
  { key: 'relevantIdeas', color: 'var(--chart-2)' },
  { key: 'topicsCreated', color: 'var(--chart-3)' },
  { key: 'translations', color: 'var(--chart-4)' },
] as const;

export interface ActivityOverviewProps {
  readonly buckets: readonly ActivityBucket[];
  readonly range: AnalyticsRange;
}

/**
 * Collection and processing over time.
 *
 * Four counts on one axis, deliberately: they are all "items per bucket", so
 * they are comparable, and a second y-axis for any of them would let the eye
 * read a crossing that is an artefact of two scales rather than anything in
 * the data.
 *
 * The range lives in the URL rather than in component state. The series comes
 * from the server, so a range change is a navigation — and putting it in the
 * URL is also what makes a particular view something a reader can bookmark or
 * paste to a colleague.
 */
export function ActivityOverview({ buckets, range }: ActivityOverviewProps) {
  const t = useTranslations('dashboard.activity');
  const rangeLabels = useTranslations('dashboard.range');
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function selectRange(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  // Hourly buckets are labelled by time, daily ones by date: a 90-day series
  // labelled with hours is unreadable, and a 24-hour one labelled with dates
  // repeats the same label all the way across.
  const hourly = range === '24h';
  const data = buckets.map((bucket) => ({
    ...bucket,
    label: format.dateTime(
      new Date(bucket.bucketStart),
      hourly ? { hour: 'numeric' } : { month: 'short', day: 'numeric' },
    ),
  }));

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <CardAction>
          <Tabs
            value={range}
            onValueChange={selectRange}
            aria-label={rangeLabels('label')}
            aria-busy={pending}
          >
            <TabsList>
              {RANGES.map((option) => (
                <TabsTrigger key={option} value={option}>
                  {rangeLabels(`short${option}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>

      <CardContent>
        {data.length === 0 ? (
          <EmptyState icon={<ActivityIcon className="size-5" />} title={t('empty')} />
        ) : (
          <>
            <ChartFrame height={280}>
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  {SERIES.map((series) => (
                    <linearGradient
                      key={series.key}
                      id={`fill-${series.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={series.color} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  minTickGap={24}
                  // Axis order is fixed to the data's own direction: time runs
                  // left to right in both languages, because reversing it in
                  // Arabic would mirror the trend itself.
                  reversed={false}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={({
                    active,
                    payload,
                    label,
                  }: TooltipContentProps<TooltipValueType, string | number>) => {
                    if (!active || payload.length === 0) return null;
                    return (
                      <ChartTooltip
                        label={String(label)}
                        entries={SERIES.map((series) => ({
                          name: t(series.key),
                          color: series.color,
                          value: format.number(
                            Number(payload.find((item) => item.dataKey === series.key)?.value ?? 0),
                          ),
                        }))}
                      />
                    );
                  }}
                />
                {SERIES.map((series) => (
                  <Area
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    stroke={series.color}
                    strokeWidth={2}
                    fill={`url(#fill-${series.key})`}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ChartFrame>

            {/* Four series always carry a legend: identity must never rest on
                colour alone. */}
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {SERIES.map((series) => (
                <li key={series.key} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className="h-0.5 w-4 rounded-full"
                    style={{ backgroundColor: series.color }}
                  />
                  <span className="text-muted-foreground">{t(series.key)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
