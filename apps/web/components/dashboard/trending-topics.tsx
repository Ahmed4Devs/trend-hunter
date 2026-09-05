import type { TrendingTopicSummary } from '@trendhunter/types';
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Sparkline,
} from '@trendhunter/ui';
import { FlameIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

/**
 * The five topics rising fastest.
 *
 * The sparkline is a shape beside a number, not a chart to measure: it says
 * "rising" while the growth percentage says how much, and its accessible name
 * carries the same thing for a reader who cannot see it.
 */
export async function TrendingTopics({
  topics,
}: {
  readonly topics: readonly TrendingTopicSummary[];
}) {
  const t = await getTranslations('dashboard.trending');
  const common = await getTranslations('common');
  const format = await getFormatter();

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <CardAction>
          <Link href="/topics" className="text-sm font-medium text-primary hover:underline">
            {common('viewAll')}
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent className="p-0 pb-2">
        {topics.length === 0 ? (
          <EmptyState
            icon={<FlameIcon className="size-5" />}
            title={t('empty')}
            description={t('emptyHint')}
          />
        ) : (
          <ul>
            {topics.map((topic) => {
              const growth = topic.growthPercentage;
              const rising = growth !== null && growth >= 0;
              const GrowthIcon = rising ? TrendingUpIcon : TrendingDownIcon;

              return (
                <li key={topic.topicId}>
                  <Link
                    href={`/topics/${topic.topicId}`}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/60"
                  >
                    <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                      {format.number(topic.rank)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{topic.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('posts', { count: topic.postCount })}
                      </span>
                    </span>

                    <span className="hidden w-24 shrink-0 sm:block">
                      <Sparkline
                        values={topic.sparkline}
                        label={t('sparkline', { name: topic.name })}
                        height={28}
                      />
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="neutral" className="tabular">
                        {format.number(topic.trendScore, { maximumFractionDigits: 1 })}
                      </Badge>
                      {growth === null ? null : (
                        <span
                          className={`tabular flex items-center gap-1 text-xs ${
                            rising ? 'text-primary' : 'text-destructive'
                          }`}
                        >
                          <GrowthIcon aria-hidden="true" className="size-3" />
                          {format.number(Math.abs(growth) / 100, {
                            style: 'percent',
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
