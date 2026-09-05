import { JOB_STATUSES, type ScanRun } from '@trendhunter/types';
import { Card, CardContent, EmptyState } from '@trendhunter/ui';
import { HistoryIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getNow, getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { ScanStatusBadge } from '@/components/scans/scan-status-badge';
import { apiFetch } from '@/lib/api/server';
import { optionalEnumParam, pageParam, paginationOf, type SearchParamRecord } from '@/lib/query';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('scans');
  return { title: t('title') };
}

export default async function ScansPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const status = optionalEnumParam(searchParams.status, JOB_STATUSES);

  const response = await apiFetch<readonly ScanRun[]>('/scans', {
    query: { page, ...(status === undefined ? {} : { status }) },
  });

  const t = await getTranslations('scans');
  const format = await getFormatter();
  // Explicit, so the server and the client agree on "now". Without it
  // next-intl falls back to each environment's own clock and the rendered
  // string changes on hydration.
  const now = await getNow();

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <FilterSelect
        paramName="status"
        label={t('status.label')}
        anyLabel={t('status.label')}
        options={JOB_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
      />

      {response.data.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon className="size-5" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {response.data.map((scan) => (
                  <li key={scan.id}>
                    <Link
                      href={`/scans/${scan.id}`}
                      aria-label={t('openScan')}
                      className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
                    >
                      <ScanStatusBadge status={scan.status} />
                      <span className="text-xs text-muted-foreground">
                        {t(`trigger.${scan.trigger}`)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('started', { time: format.relativeTime(new Date(scan.startedAt), now) })}
                      </span>
                      <span className="ms-auto flex flex-wrap items-center gap-4 text-xs">
                        <span className="tabular">
                          {t('stored')} {format.number(scan.itemsStored)}
                        </span>
                        <span className="tabular">
                          {t('posts')} {format.number(scan.postsCreated)}
                        </span>
                        <span className="tabular">
                          {t('topics')} {format.number(scan.topicsCreated)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <PaginationControls pagination={paginationOf(response.meta, page)} />
        </>
      )}
    </div>
  );
}
