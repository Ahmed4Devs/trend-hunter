import { CONTENT_DRAFT_STATUSES, type Thread, type Topic } from '@trendhunter/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@trendhunter/ui';
import { MessagesSquareIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { ThreadCard } from '@/components/threads/thread-card';
import { ThreadForm } from '@/components/threads/thread-form';
import { apiData, apiFetch } from '@/lib/api/server';
import { optionalEnumParam, pageParam, paginationOf, type SearchParamRecord } from '@/lib/query';

const TOPIC_CHOICES = 20;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('threads');
  return { title: t('title') };
}

export default async function ThreadsPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const status = optionalEnumParam(searchParams.status, CONTENT_DRAFT_STATUSES);

  const [threads, topics] = await Promise.all([
    apiFetch<readonly Thread[]>('/threads', {
      query: { page, ...(status === undefined ? {} : { status }) },
    }),
    apiData<readonly Topic[]>('/trends', { query: { limit: TOPIC_CHOICES } }),
  ]);

  const t = await getTranslations('threads');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>{t('create')}</CardTitle>
          <CardDescription>{t('createDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThreadForm topics={topics} />
        </CardContent>
      </Card>

      <FilterSelect
        paramName="status"
        label={t('status.label')}
        anyLabel={t('status.label')}
        options={CONTENT_DRAFT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
      />

      {threads.data.length === 0 ? (
        <EmptyState
          icon={<MessagesSquareIcon className="size-5" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <div className="space-y-4">
            {threads.data.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} />
            ))}
          </div>
          <PaginationControls pagination={paginationOf(threads.meta, page)} />
        </>
      )}
    </div>
  );
}
