import { TRANSLATION_MODES, type Translation } from '@trendhunter/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@trendhunter/ui';
import { LanguagesIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { SearchField } from '@/components/common/search-field';
import { TranslationCard } from '@/components/translations/translation-card';
import { TranslationForm } from '@/components/translations/translation-form';
import { apiFetch } from '@/lib/api/server';
import {
  optionalEnumParam,
  pageParam,
  paginationOf,
  textParam,
  type SearchParamRecord,
} from '@/lib/query';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('translations');
  return { title: t('title') };
}

export default async function TranslationsPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const mode = optionalEnumParam(searchParams.mode, TRANSLATION_MODES);
  const search = textParam(searchParams.search);

  const response = await apiFetch<readonly Translation[]>('/translations', {
    query: {
      page,
      ...(mode === undefined ? {} : { mode }),
      ...(search === undefined ? {} : { search }),
    },
  });

  const t = await getTranslations('translations');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>{t('new')}</CardTitle>
          <CardDescription>{t('newDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <TranslationForm />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField placeholder={t('searchPlaceholder')} label={t('searchLabel')} />
        <FilterSelect
          paramName="mode"
          label={t('mode.label')}
          anyLabel={t('mode.label')}
          options={TRANSLATION_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
        />
      </div>

      {response.data.length === 0 ? (
        <EmptyState
          icon={<LanguagesIcon className="size-5" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <div className="space-y-4">
            {response.data.map((translation) => (
              <TranslationCard key={translation.id} translation={translation} />
            ))}
          </div>
          <PaginationControls pagination={paginationOf(response.meta, page)} />
        </>
      )}
    </div>
  );
}
