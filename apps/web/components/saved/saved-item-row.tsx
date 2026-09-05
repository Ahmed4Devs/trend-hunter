'use client';

import type { SavedItem } from '@trendhunter/types';
import { Badge, Button, toast } from '@trendhunter/ui';
import { Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/** Where a saved item points, by kind. */
function hrefFor(item: SavedItem): string | null {
  if (item.postId !== null) return `/posts/${item.postId}`;
  if (item.topicId !== null) return `/topics/${item.topicId}`;
  if (item.threadId !== null) return `/threads/${item.threadId}`;
  if (item.contentDraftId !== null) return `/content/${item.contentDraftId}`;
  return null;
}

export function SavedItemRow({ item }: { readonly item: SavedItem }) {
  const t = useTranslations('saved');
  const common = useTranslations('common');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove(): Promise<void> {
    setPending(true);
    try {
      await browserFetch(`/saved/${item.id}`, { method: 'DELETE' });
      toast.success(t('removed'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  const href = hrefFor(item);

  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{t(`kind.${item.kind}`)}</Badge>
          {item.collection === null ? null : <Badge variant="blue">{item.collection}</Badge>}
        </div>
        {href === null ? null : (
          <Link href={href} className="text-sm text-primary hover:underline">
            {href}
          </Link>
        )}
        {item.note === null ? null : <p className="text-sm text-muted-foreground">{item.note}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={t('remove')}
        onClick={() => {
          void remove();
        }}
      >
        <Trash2Icon className="size-4 text-destructive" />
      </Button>
    </li>
  );
}
