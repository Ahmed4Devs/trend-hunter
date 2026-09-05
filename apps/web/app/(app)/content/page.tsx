import {
  CONTENT_DRAFT_KINDS,
  CONTENT_DRAFT_STATUSES,
  type ContentDraft,
  type Topic,
} from '@trendhunter/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@trendhunter/ui';
import { SparklesIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { DraftCard } from '@/components/content/draft-card';
import { GenerateForm } from '@/components/content/generate-form';
import { apiData, apiFetch } from '@/lib/api/server';
import { optionalEnumParam, pageParam, paginationOf, type SearchParamRecord } from '@/lib/query';

/** Topics offered in the generator. Enough to choose from, not a second list page. */
const TOPIC_CHOICES = 20;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('content');
  return { title: t('title') };
}

export default async function ContentPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const page = pageParam(searchParams.page);
  const kind = optionalEnumParam(searchParams.kind, CONTENT_DRAFT_KINDS);
  const status = optionalEnumParam(searchParams.status, CONTENT_DRAFT_STATUSES);

  const [drafts, topics] = await Promise.all([
    apiFetch<readonly ContentDraft[]>('/content/drafts', {
      query: {
        page,
        ...(kind === undefined ? {} : { kind }),
        ...(status === undefined ? {} : { status }),
      },
    }),
    apiData<readonly Topic[]>('/trends', { query: { limit: TOPIC_CHOICES } }),
  ]);

  const t = await getTranslations('content');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>{t('generateTitle')}</CardTitle>
          <CardDescription>{t('generateDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <GenerateForm topics={topics} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          paramName="kind"
          label={t('kind.label')}
          anyLabel={t('kind.label')}
          options={CONTENT_DRAFT_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
          className="w-52"
        />
        <FilterSelect
          paramName="status"
          label={t('status.label')}
          anyLabel={t('status.label')}
          options={CONTENT_DRAFT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
        />
      </div>

      {drafts.data.length === 0 ? (
        <EmptyState
          icon={<SparklesIcon className="size-5" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <div className="space-y-4">
            {drafts.data.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
          </div>
          <PaginationControls pagination={paginationOf(drafts.meta, page)} />
        </>
      )}
    </div>
  );
}
