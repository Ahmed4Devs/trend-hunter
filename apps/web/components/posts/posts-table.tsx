'use client';

import type { PaginationMeta, Post } from '@trendhunter/types';
import { Badge, columnHelperFor, DataTable, EmptyState } from '@trendhunter/ui';
import { InboxIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { SourceBadge } from '@/components/dashboard/source-badge';
import { PaginationControls } from '@/components/common/pagination-controls';

import { SavePostButton } from './save-post-button';

const column = columnHelperFor<Post>();

/**
 * The posts grid.
 *
 * Columns are declared here and the rows come from the server already paged,
 * sorted and filtered. The row click opens the detail page; the save control
 * stops the event, because a button nested in a clickable row would otherwise
 * navigate as well as save.
 */
export function PostsTable({
  posts,
  pagination,
}: {
  readonly posts: readonly Post[];
  readonly pagination: PaginationMeta;
}) {
  const t = useTranslations('posts');
  const format = useFormatter();
  const router = useRouter();

  // `column.columns` keeps each definition's own value type through the array,
  // which is what makes `getValue()` precise in every cell below.
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor('source', {
          header: () => t('columns.source'),
          cell: (context) => <SourceBadge source={context.getValue()} />,
        }),
        column.accessor('authorName', {
          header: () => t('columns.author'),
          cell: (context) => (
            <span className="block max-w-32 truncate text-sm text-muted-foreground">
              {context.getValue() ?? '—'}
            </span>
          ),
        }),
        column.display({
          id: 'content',
          header: () => t('columns.content'),
          cell: (context) => {
            const post = context.row.original;
            return (
              <span className="block max-w-md">
                <span className="line-clamp-2 text-sm">{post.title ?? post.content}</span>
              </span>
            );
          },
        }),
        column.accessor('language', {
          header: () => t('columns.language'),
          cell: (context) => <Badge variant="neutral">{context.getValue()}</Badge>,
        }),
        column.accessor('topicName', {
          header: () => t('columns.topic'),
          cell: (context) => {
            const name = context.getValue();
            return name === null ? (
              <span className="text-xs text-muted-foreground">{t('noTopic')}</span>
            ) : (
              <span className="block max-w-40 truncate text-sm">{name}</span>
            );
          },
        }),
        column.accessor((post) => post.metrics.engagementScore, {
          id: 'engagement',
          header: () => t('columns.engagement'),
          cell: (context) => (
            <span className="tabular text-sm">
              {format.number(context.getValue(), { maximumFractionDigits: 0 })}
            </span>
          ),
        }),
        column.accessor('relevanceScore', {
          id: 'relevance',
          header: () => t('columns.relevance'),
          cell: (context) => (
            <Badge variant="green" className="tabular">
              {format.number(context.getValue(), { maximumFractionDigits: 0 })}
            </Badge>
          ),
        }),
        column.accessor('publishedAt', {
          header: () => t('columns.published'),
          cell: (context) => (
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {format.relativeTime(new Date(context.getValue()))}
            </span>
          ),
        }),
        column.display({
          id: 'actions',
          header: () => <span className="sr-only">{t('columns.actions')}</span>,
          cell: (context) => (
            <span
              // The row is a link target; the control inside it is not.
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <SavePostButton
                postId={context.row.original.id}
                initiallySaved={context.row.original.isSaved}
              />
            </span>
          ),
        }),
      ]),
    [t, format],
  );

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        data={posts}
        getRowId={(post) => post.id}
        onRowClick={(post) => {
          router.push(`/posts/${post.id}`);
        }}
        empty={
          <EmptyState
            icon={<InboxIcon className="size-5" />}
            title={t('empty')}
            description={t('emptyHint')}
          />
        }
      />
      <PaginationControls pagination={pagination} />
    </div>
  );
}
