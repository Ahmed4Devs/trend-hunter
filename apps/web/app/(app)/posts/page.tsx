import { CONTENT_LANGUAGES, SOURCE_KINDS, type Post } from '@trendhunter/types';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { SearchField } from '@/components/common/search-field';
import { PostsTable } from '@/components/posts/posts-table';
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
  'publishedAt',
  'relevanceScore',
  'trendScore',
  'engagementScore',
  'collectedAt',
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('posts');
  return { title: t('title') };
}

export default async function PostsPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const sortBy = enumParam(searchParams.sortBy, SORT_FIELDS, 'publishedAt');
  const sources = csvEnumParam(searchParams.sources, SOURCE_KINDS);
  const languages = csvEnumParam(searchParams.languages, CONTENT_LANGUAGES);
  const search = textParam(searchParams.search);

  const response = await apiFetch<readonly Post[]>('/posts', {
    query: {
      page,
      sortBy,
      // Descending for every sort this page offers: newest first, highest score
      // first. An ascending default would open the list on the least relevant
      // post it has.
      sortDirection: 'desc',
      ...(sources === undefined ? {} : { sources: sources.join(',') }),
      ...(languages === undefined ? {} : { languages: languages.join(',') }),
      ...(search === undefined ? {} : { search }),
    },
  });

  const t = await getTranslations('posts');
  const filters = await getTranslations('filters');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchField placeholder={t('searchPlaceholder')} label={t('searchLabel')} />
        <FilterSelect
          paramName="sources"
          label={filters('source')}
          anyLabel={filters('anySource')}
          options={SOURCE_KINDS.map((source) => ({ value: source, label: source }))}
        />
        <FilterSelect
          paramName="languages"
          label={filters('language')}
          anyLabel={filters('anyLanguage')}
          options={CONTENT_LANGUAGES.map((language) => ({ value: language, label: language }))}
        />
        <FilterSelect
          paramName="sortBy"
          label={filters('sort')}
          anyLabel={t('sort.publishedAt')}
          options={SORT_FIELDS.map((field) => ({ value: field, label: t(`sort.${field}`) }))}
        />
      </div>

      <PostsTable posts={response.data} pagination={paginationOf(response.meta, page)} />
    </div>
  );
}
