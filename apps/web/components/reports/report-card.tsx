'use client';

import type { Report, ReportResult } from '@trendhunter/types';
import { Badge, Button, Card, CardContent, ChartFrame, ChartTooltip, toast } from '@trendhunter/ui';
import { Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  type TooltipContentProps,
  type TooltipValueType,
  XAxis,
  YAxis,
} from 'recharts';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/** The payload is stored as JSON; this narrows it before anything reads it. */
function resultOf(report: Report): ReportResult | null {
  const payload = report.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('series' in payload) || !('breakdown' in payload)) return null;
  return payload as ReportResult;
}

/**
 * One stored report.
 *
 * Bars, not a line: these are counts per labelled bucket, and the labels are
 * categories as often as they are dates — a line drawn between two categories
 * asserts a continuity that is not there.
 */
export function ReportCard({ report }: { readonly report: Report }) {
  const t = useTranslations('reports');
  const common = useTranslations('common');
  const router = useRouter();
  const format = useFormatter();
  // Explicit, and refreshed on an interval: without it next-intl reads the
  // environment's clock, the server and the client disagree at hydration, and
  // the string never updates afterwards.
  const now = useNow({ updateInterval: 60_000 });
  const [pending, setPending] = useState(false);

  const result = resultOf(report);
  const points = result === null ? [] : result.series.length > 0 ? result.series : result.breakdown;

  async function remove(): Promise<void> {
    setPending(true);
    try {
      await browserFetch(`/reports/${report.id}`, { method: 'DELETE' });
      toast.success(t('deleted'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-semibold">{report.title}</p>
            <p className="text-xs text-muted-foreground">
              {t('range', {
                from: format.dateTime(new Date(report.rangeFrom), { dateStyle: 'medium' }),
                to: format.dateTime(new Date(report.rangeTo), { dateStyle: 'medium' }),
              })}{' '}
              · {t('generatedAt', { time: format.relativeTime(new Date(report.generatedAt), now) })}
            </p>
          </div>
          <Badge variant="purple">{t(`kind.${report.kind}`)}</Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={t('delete')}
            onClick={() => {
              void remove();
            }}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        </div>

        {result === null ? null : (
          <p className="text-sm">
            <span className="text-muted-foreground">{t('total')} </span>
            <span className="tabular font-semibold">{format.number(result.total)}</span>
          </p>
        )}

        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noData')}</p>
        ) : (
          <ChartFrame height={200}>
            <BarChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                minTickGap={16}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                allowDecimals={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                content={({
                  active,
                  payload,
                  label,
                }: TooltipContentProps<TooltipValueType, string | number>) => {
                  if (!active || payload.length === 0) return null;
                  return (
                    <ChartTooltip
                      label={String(label)}
                      entries={[
                        {
                          name: t('total'),
                          color: 'var(--chart-1)',
                          value: format.number(Number(payload[0]?.value ?? 0)),
                        },
                      ]}
                    />
                  );
                }}
              />
              {/* Rounded data-ends, anchored to the baseline. */}
              <Bar
                dataKey="value"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartFrame>
        )}
      </CardContent>
    </Card>
  );
}
