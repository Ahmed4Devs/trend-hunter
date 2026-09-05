'use client';

import type { PaginationMeta } from '@trendhunter/types';
import { Button } from '@trendhunter/ui';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { useQueryState } from './use-query-state';

/**
 * Page navigation for a server-paginated list.
 *
 * Previous/next only. A numbered pager would need a total page count that is
 * honest, and relevance-ranked lists cannot produce one cheaply — the API says
 * as much by reporting `hasNextPage` rather than a total it would have to
 * invent.
 */
export function PaginationControls({ pagination }: { readonly pagination: PaginationMeta }) {
  const t = useTranslations('pagination');
  const format = useFormatter();
  const { setParams, pending } = useQueryState();

  function goTo(page: number): void {
    // The page is not reset here — it is the thing being set.
    setParams({ page: String(page) }, { resetPage: false });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <p className="text-muted-foreground text-sm">
        {t('summary', {
          page: format.number(pagination.page),
          total: format.number(pagination.totalItems),
        })}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!pagination.hasPreviousPage || pending}
          onClick={() => {
            goTo(pagination.page - 1);
          }}
        >
          {/* The chevron points backwards in reading order, so it flips. */}
          <ChevronLeftIcon className="size-4 rtl:rotate-180" />
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!pagination.hasNextPage || pending}
          onClick={() => {
            goTo(pagination.page + 1);
          }}
        >
          {t('next')}
          <ChevronRightIcon className="size-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
