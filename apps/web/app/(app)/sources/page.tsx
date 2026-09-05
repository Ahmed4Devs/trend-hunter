import type { Interest, Source } from '@trendhunter/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@trendhunter/ui';
import { RadioIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { SourceBadge } from '@/components/dashboard/source-badge';
import { InterestForm } from '@/components/sources/interest-form';
import { InterestList } from '@/components/sources/interest-list';
import { SourceToggle } from '@/components/sources/source-toggle';
import { apiData } from '@/lib/api/server';
import { requireCurrentUser } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sources');
  return { title: t('title') };
}

export default async function SourcesPage() {
  // Both lists and the caller, in parallel: they are independent reads and
  // sequencing them would add a round trip for nothing.
  const [user, sources, interests] = await Promise.all([
    requireCurrentUser(),
    apiData<readonly Source[]>('/sources'),
    apiData<readonly Interest[]>('/interests'),
  ]);

  const t = await getTranslations('sources');
  const interestsT = await getTranslations('sources.interests');
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {sources.length === 0 ? (
        <EmptyState icon={<RadioIcon className="size-5" />} title={t('empty')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <SourceBadge source={source.kind} />
                    <p className="truncate text-sm font-semibold">{source.name}</p>
                  </div>
                  <SourceToggle
                    sourceId={source.id}
                    enabled={source.enabled}
                    canEdit={user.role === 'ADMIN'}
                  />
                </div>

                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">
                      {t('posts', { count: source.postCount })}
                    </dt>
                    <dd className="tabular">
                      {t('interval', { minutes: format.number(source.scanIntervalMinutes) })}
                    </dd>
                  </div>
                  <div className="text-muted-foreground">
                    {source.lastScannedAt === null
                      ? t('neverCollected')
                      : t('lastCollected', {
                          time: format.relativeTime(new Date(source.lastScannedAt)),
                        })}
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>{interestsT('title')}</CardTitle>
          <CardDescription>{interestsT('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InterestForm />
          <InterestList interests={interests} />
        </CardContent>
      </Card>
    </div>
  );
}
