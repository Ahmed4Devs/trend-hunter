import type { Topic, TopicClassification } from '@trendhunter/types';
import { Badge, Card, CardContent } from '@trendhunter/ui';
import Link from 'next/link';
import { getFormatter, getNow, getTranslations } from 'next-intl/server';

import { SourceBadge } from '@/components/dashboard/source-badge';

/**
 * Classification tone.
 *
 * A hidden gem and an emerging trend are the two the product exists to
 * surface, so they get the accent colours; saturated is a warning and normal
 * is deliberately unremarkable.
 */
const CLASSIFICATION_VARIANT: Record<
  TopicClassification,
  'neutral' | 'green' | 'purple' | 'orange'
> = {
  NORMAL: 'neutral',
  EMERGING_TREND: 'green',
  HIDDEN_GEM: 'purple',
  SATURATED: 'orange',
};

export async function TopicCard({ topic }: { readonly topic: Topic }) {
  const t = await getTranslations('topics');
  const detail = await getTranslations('topics.detail');
  const format = await getFormatter();
  // Explicit, so the server and the client agree on "now". Without it
  // next-intl falls back to each environment's own clock and the rendered
  // string changes on hydration.
  const now = await getNow();

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/topics/${topic.id}`} className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{topic.name}</h2>
          </Link>
          <Badge variant={CLASSIFICATION_VARIANT[topic.classification]}>
            {t(`classification.${topic.classification}`)}
          </Badge>
        </div>

        {topic.summary === null ? null : (
          <p className="line-clamp-2 text-sm text-muted-foreground">{topic.summary}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {topic.sourceKinds.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">{detail('trend')}</dt>
            <dd className="tabular font-medium">
              {format.number(topic.trendScore, { maximumFractionDigits: 1 })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{detail('opportunity')}</dt>
            <dd className="tabular font-medium">
              {format.number(topic.arabicOpportunityScore, { maximumFractionDigits: 1 })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('posts', { count: topic.postCount })}</dt>
            <dd className="tabular font-medium">
              {format.relativeTime(new Date(topic.lastDetectedAt), now)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
