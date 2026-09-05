import { REPORT_KINDS, type Report } from '@trendhunter/types';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@trendhunter/ui';
import { FileBarChartIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { ReportCard } from '@/components/reports/report-card';
import { ReportForm } from '@/components/reports/report-form';
import { apiFetch } from '@/lib/api/server';
import { optionalEnumParam, pageParam, paginationOf, type SearchParamRecord } from '@/lib/query';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports');
  return { title: t('title') };
}

export default async function ReportsPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const kind = optionalEnumParam(searchParams.kind, REPORT_KINDS);

  const response = await apiFetch<readonly Report[]>('/reports', {
    query: { page, ...(kind === undefined ? {} : { kind }) },
  });

  const t = await getTranslations('reports');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('generate')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportForm />
        </CardContent>
      </Card>

      <FilterSelect
        paramName="kind"
        label={t('kind.label')}
        anyLabel={t('kind.label')}
        options={REPORT_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
        className="w-56"
      />

      {response.data.length === 0 ? (
        <EmptyState
          icon={<FileBarChartIcon className="size-5" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <div className="space-y-4">
            {response.data.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
          <PaginationControls pagination={paginationOf(response.meta, page)} />
        </>
      )}
    </div>
  );
}
