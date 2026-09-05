import { ANALYTICS_RANGES, type AnalyticsRange, type DashboardSummary } from '@trendhunter/types';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ActivityOverview } from '@/components/dashboard/activity-overview';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { RecentPosts } from '@/components/dashboard/recent-posts';
import { SourceDistribution } from '@/components/dashboard/source-distribution';
import { SystemUsage } from '@/components/dashboard/system-usage';
import { TrendingTopics } from '@/components/dashboard/trending-topics';
import { apiData } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

/**
 * Reads the range from the query string.
 *
 * Validated against the allowed set rather than passed through: it reaches the
 * API as a query parameter, and an unrecognised value should render the default
 * view instead of a validation error page.
 */
function parseRange(value: string | string[] | undefined): AnalyticsRange {
  const candidate = Array.isArray(value) ? value[0] : value;
  return ANALYTICS_RANGES.includes(candidate as AnalyticsRange)
    ? (candidate as AnalyticsRange)
    : '7d';
}

export default async function DashboardPage(props: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const range = parseRange(searchParams.range);

  // One request for the whole page. Every panel below is part of the same
  // consistent snapshot, computed against one clock on the server — six
  // parallel requests would let the KPI cards and the activity chart disagree
  // about where "now" is.
  const summary = await apiData<DashboardSummary>('/dashboard', { query: { range } });

  const t = await getTranslations('dashboard');
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('generatedAt', {
            time: format.dateTime(new Date(summary.generatedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
      </header>

      <KpiCards kpis={summary.kpis} />

      <ActivityOverview buckets={summary.activity} range={summary.range} />

      <div className="grid gap-6 xl:grid-cols-2">
        <TrendingTopics topics={summary.trendingTopics} />
        <SourceDistribution slices={summary.sourceDistribution} total={summary.totalPosts} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentPosts posts={summary.recentPosts} />
        <div className="space-y-6">
          <QuickActions />
          <SystemUsage usage={summary.apiUsage} health={summary.health} />
        </div>
      </div>
    </div>
  );
}
