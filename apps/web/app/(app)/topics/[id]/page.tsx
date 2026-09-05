import type { TopicDetail, TopicClassification } from '@trendhunter/types';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Separator,
} from '@trendhunter/ui';
import { InboxIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getNow, getTranslations } from 'next-intl/server';

import { SourceBadge } from '@/components/dashboard/source-badge';
import { ScoreMeter } from '@/components/posts/score-meter';
import { TrendHistory } from '@/components/topics/trend-history';
import { ApiError } from '@/lib/api/errors';
import { apiData } from '@/lib/api/server';

const CLASSIFICATION_VARIANT: Record<
  TopicClassification,
  'neutral' | 'green' | 'purple' | 'orange'
> = {
  NORMAL: 'neutral',
  EMERGING_TREND: 'green',
  HIDDEN_GEM: 'purple',
  SATURATED: 'orange',
};

async function loadTopic(id: string): Promise<TopicDetail> {
  try {
    return await apiData<TopicDetail>(`/topics/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) notFound();
    throw error;
  }
}

export async function generateMetadata(props: {
  readonly params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const topic = await loadTopic(id);
  return { title: topic.name };
}

export default async function TopicDetailPage(props: { readonly params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const topic = await loadTopic(id);

  const t = await getTranslations('topics.detail');
  const topics = await getTranslations('topics');
  const format = await getFormatter();
  // Explicit, so the server and the client agree on "now". Without it
  // next-intl falls back to each environment's own clock and the rendered
  // string changes on hydration.
  const now = await getNow();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={CLASSIFICATION_VARIANT[topic.classification]}>
            {topics(`classification.${topic.classification}`)}
          </Badge>
          {topic.sourceKinds.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
        {topic.summary === null ? null : (
          <p className="text-sm text-muted-foreground">{topic.summary}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('firstSeen', { time: format.relativeTime(new Date(topic.firstDetectedAt), now) })} ·{' '}
          {t('lastSeen', { time: format.relativeTime(new Date(topic.lastDetectedAt), now) })}
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('history')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendHistory snapshots={topic.snapshots} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('posts')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {topic.posts.length === 0 ? (
                <EmptyState icon={<InboxIcon className="size-5" />} title={t('noPosts')} />
              ) : (
                <ul className="divide-y divide-border">
                  {topic.posts.map((post) => (
                    <li key={post.id}>
                      <Link
                        href={`/posts/${post.id}`}
                        className="block space-y-1.5 px-5 py-3 transition-colors hover:bg-muted/50"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <SourceBadge source={post.source} />
                          <span className="text-xs text-muted-foreground">
                            {format.relativeTime(new Date(post.publishedAt), now)}
                          </span>
                          <Badge variant="neutral">{post.language}</Badge>
                        </span>
                        <span className="line-clamp-2 block text-sm">
                          {post.title ?? post.content}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('components')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ScoreMeter label={t('trend')} value={topic.trendScore} />
              <ScoreMeter label={t('relevance')} value={topic.relevanceScore} tone="blue" />
              <ScoreMeter
                label={t('opportunity')}
                value={topic.arabicOpportunityScore}
                tone="purple"
              />

              <Separator />

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('english')}</dt>
                  <dd className="tabular font-medium">{format.number(topic.englishPostCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('arabic')}</dt>
                  <dd className="tabular font-medium">{format.number(topic.arabicPostCount)}</dd>
                </div>
              </dl>

              {topic.classificationReasons.length === 0 ? null : (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{t('why')}</p>
                    <ul className="space-y-1.5">
                      {topic.classificationReasons.map((reason) => (
                        <li key={reason.reason} className="text-sm">
                          <span className="font-medium">{topics(`signals.${reason.reason}`)}</span>
                          {/* The engine reports numeric facts rather than a
                              sentence, so the numbers are shown as they are —
                              writing prose around them here would be the UI
                              re-deriving a judgement the engine already made. */}
                          <span className="text-muted-foreground">
                            {' '}
                            {Object.entries(reason.detail)
                              .map(
                                ([key, value]) =>
                                  `${key} ${format.number(value, { maximumFractionDigits: 2 })}`,
                              )
                              .join(' · ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sources')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {topic.sourceBreakdown.map((slice) => (
                  <li key={slice.source} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{slice.source}</span>
                    <span className="tabular text-muted-foreground">
                      {format.number(slice.count)}
                    </span>
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
        </div>
      </div>
    </div>
  );
}
