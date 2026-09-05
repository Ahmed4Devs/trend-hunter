import { SAVED_ITEM_KINDS, type ManualPublication, type SavedItem } from '@trendhunter/types';
import { Card, CardContent, EmptyState } from '@trendhunter/ui';
import { BookmarkIcon, SendIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FilterSelect } from '@/components/common/filter-select';
import { PageHeader } from '@/components/common/page-header';
import { PaginationControls } from '@/components/common/pagination-controls';
import { TabLinks } from '@/components/common/tab-links';
import { PublicationRow } from '@/components/saved/publication-row';
import { SavedItemRow } from '@/components/saved/saved-item-row';
import { apiFetch } from '@/lib/api/server';
import {
  enumParam,
  optionalEnumParam,
  pageParam,
  paginationOf,
  textParam,
  type SearchParamRecord,
} from '@/lib/query';

const TABS = ['items', 'publications'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('saved');
  return { title: t('title') };
}

export default async function SavedPage(props: {
  readonly searchParams: Promise<SearchParamRecord>;
}) {
  const searchParams = await props.searchParams;
  const tab = enumParam(searchParams.tab, TABS, 'items');
  const page = pageParam(searchParams.page);
  const kind = optionalEnumParam(searchParams.kind, SAVED_ITEM_KINDS);
  const collection = textParam(searchParams.collection, 60);

  const t = await getTranslations('saved');
  const publications = await getTranslations('saved.publications');

  // Only the visible tab is fetched. Loading both would double the work of
  // every page view to render something the reader is not looking at.
  const response =
    tab === 'items'
      ? await apiFetch<readonly SavedItem[]>('/saved', {
          query: {
            page,
            ...(kind === undefined ? {} : { kind }),
            ...(collection === undefined ? {} : { collection }),
          },
        })
      : await apiFetch<readonly ManualPublication[]>('/manual-publications', { query: { page } });

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-wrap items-center gap-3">
        <TabLinks
          label={t('title')}
          tabs={TABS.map((value) => ({
            href: value === 'items' ? '/saved' : `/saved?tab=${value}`,
            label: t(`tabs.${value}`),
            active: tab === value,
          }))}
        />
        {tab === 'items' ? (
          <FilterSelect
            paramName="kind"
            label={t('kind.label')}
            anyLabel={t('kind.label')}
            options={SAVED_ITEM_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
          />
        ) : null}
      </div>

      <Card>
        <CardContent className="p-5">
          {response.data.length === 0 ? (
            tab === 'items' ? (
              <EmptyState
                icon={<BookmarkIcon className="size-5" />}
                title={t('empty')}
                description={t('emptyHint')}
              />
            ) : (
              <EmptyState
                icon={<SendIcon className="size-5" />}
                title={publications('empty')}
                description={publications('emptyHint')}
              />
            )
          ) : (
            <ul className="divide-y divide-border">
              {tab === 'items'
                ? (response.data as readonly SavedItem[]).map((item) => (
                    <SavedItemRow key={item.id} item={item} />
                  ))
                : (response.data as readonly ManualPublication[]).map((publication) => (
                    <PublicationRow key={publication.id} publication={publication} />
                  ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PaginationControls pagination={paginationOf(response.meta, page)} />
    </div>
  );
}
