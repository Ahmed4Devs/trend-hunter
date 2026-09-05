import type { JobRun, ScanRun } from '@trendhunter/types';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@trendhunter/ui';
import { ListChecksIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { SourceBadge } from '@/components/dashboard/source-badge';
import { ScanStatusBadge } from '@/components/scans/scan-status-badge';
import { ApiError } from '@/lib/api/errors';
import { apiData } from '@/lib/api/server';

/** Jobs shown for one scan. A run fans out to a few dozen at most. */
const JOB_PAGE_SIZE = 100;

async function loadScan(id: string): Promise<ScanRun> {
  try {
    return await apiData<ScanRun>(`/scans/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) notFound();
    throw error;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('scans');
  return { title: t('title') };
}

export default async function ScanDetailPage(props: { readonly params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const scan = await loadScan(id);
  const jobs = await apiData<readonly JobRun[]>('/jobs', {
    query: { scanRunId: id, pageSize: JOB_PAGE_SIZE },
  });

  const t = await getTranslations('scans');
  const format = await getFormatter();

  const counters = [
    { labelKey: 'collected', value: scan.itemsCollected },
    { labelKey: 'stored', value: scan.itemsStored },
    { labelKey: 'duplicates', value: scan.duplicatesSkipped },
    { labelKey: 'posts', value: scan.postsCreated },
    { labelKey: 'comments', value: scan.commentsCreated },
    { labelKey: 'topics', value: scan.topicsCreated },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('started', {
          time: format.dateTime(new Date(scan.startedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        })}
        actions={<ScanStatusBadge status={scan.status} />}
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{t(`trigger.${scan.trigger}`)}</Badge>
            {scan.sourceKinds.map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
            {scan.durationMs === null ? null : (
              <span className="tabular text-xs text-muted-foreground">
                {t('duration')}{' '}
                {format.number(scan.durationMs / 1000, { maximumFractionDigits: 1 })}s
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {counters.map((counter) => (
              <div key={counter.labelKey}>
                <dt className="text-xs text-muted-foreground">{t(counter.labelKey)}</dt>
                <dd className="tabular text-lg font-semibold">{format.number(counter.value)}</dd>
              </div>
            ))}
          </dl>

          {scan.failureReason === null ? null : (
            <p className="text-sm text-destructive">
              {t('failure')}: {scan.failureReason}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('jobs.title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {jobs.length === 0 ? (
            <EmptyState icon={<ListChecksIcon className="size-5" />} title={t('jobs.empty')} />
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <ScanStatusBadge status={job.status} />
                  <span className="font-mono text-xs" dir="ltr">
                    {job.queue}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('jobs.attempt', {
                      current: format.number(job.attempt),
                      max: format.number(job.maxAttempts),
                    })}
                  </span>
                  {job.durationMs === null ? null : (
                    <span className="tabular text-xs text-muted-foreground">
                      {format.number(job.durationMs / 1000, { maximumFractionDigits: 1 })}s
                    </span>
                  )}
                  {job.failureReason === null ? null : (
                    <span className="w-full text-xs text-destructive">{job.failureReason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
