import { SOURCE_KINDS, TOPIC_CLASSIFICATIONS, type Topic } from '@trendhunter/types';
import { EmptyState } from '@trendhunter/ui';
import { FolderTreeIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { SearchField } from '@/components/common/search-field';
import { TopicCard } from '@/components/topics/topic-card';
import { apiFetch } from '@/lib/api/server';
import {
  csvEnumParam,
  enumParam,
  pageParam,
  paginationOf,
  textParam,
  type SearchParamRecord,
} from '@/lib/query';

const SORT_FIELDS = [
  'trendScore',
  'relevanceScore',
  'arabicOpportunityScore',
  'postCount',
  'velocity',
  'firstDetectedAt',
  'lastDetectedAt',
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('topics');
  return { title: t('title') };
}

export default async function TopicsPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const sortBy = enumParam(searchParams.sortBy, SORT_FIELDS, 'trendScore');
  const classifications = csvEnumParam(searchParams.classifications, TOPIC_CLASSIFICATIONS);
  const sources = csvEnumParam(searchParams.sources, SOURCE_KINDS);
  const search = textParam(searchParams.search);

  const response = await apiFetch<readonly Topic[]>('/topics', {
    query: {
      page,
      sortBy,
      sortDirection: 'desc',
      ...(classifications === undefined ? {} : { classifications: classifications.join(',') }),
      ...(sources === undefined ? {} : { sources: sources.join(',') }),
      ...(search === undefined ? {} : { search }),
    },
  });

  const t = await getTranslations('topics');
  const filters = await getTranslations('filters');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchField placeholder={t('searchPlaceholder')} label={t('searchLabel')} />
        <FilterSelect
          paramName="classifications"
          label={t('classification.label')}
          anyLabel={filters('anyStatus')}
          options={TOPIC_CLASSIFICATIONS.map((value) => ({
            value,
            label: t(`classification.${value}`),
          }))}
        />
        <FilterSelect
          paramName="sources"
          label={filters('source')}
          anyLabel={filters('anySource')}
          options={SOURCE_KINDS.map((source) => ({ value: source, label: source }))}
        />
        <FilterSelect
          paramName="sortBy"
          label={filters('sort')}
          anyLabel={t('sort.trendScore')}
          options={SORT_FIELDS.map((field) => ({ value: field, label: t(`sort.${field}`) }))}
        />
      </div>

      {response.data.length === 0 ? (
        <EmptyState
          icon={<FolderTreeIcon className="size-5" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {response.data.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
          <PaginationControls pagination={paginationOf(response.meta, page)} />
        </>
      )}
    </div>
  );
}
