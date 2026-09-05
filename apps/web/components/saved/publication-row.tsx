'use client';

import type { ManualPublication } from '@trendhunter/types';
import { Badge, Button, toast } from '@trendhunter/ui';
import { ExternalLinkIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * One recorded publication.
 *
 * The product never publishes; these rows are what the user typed after
 * posting by hand, which is what makes "what was generated versus what was
 * actually shipped" answerable later.
 */
export function PublicationRow({ publication }: { readonly publication: ManualPublication }) {
  const t = useTranslations('saved.publications');
  const common = useTranslations('common');
  const router = useRouter();
  const format = useFormatter();
  const [pending, setPending] = useState(false);

  async function remove(): Promise<void> {
    setPending(true);
    try {
      await browserFetch(`/manual-publications/${publication.id}`, { method: 'DELETE' });
      toast.success(t('deleted'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{publication.contentKind}</Badge>
          <Badge variant="blue">{publication.language}</Badge>
          <span className="text-xs text-muted-foreground">
            {format.dateTime(new Date(publication.publishedAt), { dateStyle: 'medium' })}
          </span>
        </div>
        <p
          className="line-clamp-3 text-sm whitespace-pre-wrap"
          dir={publication.language === 'AR' ? 'rtl' : 'ltr'}
        >
          {publication.publishedContent}
        </p>
        {publication.publishedUrl === null ? null : (
          <a
            href={publication.publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLinkIcon className="size-3.5" />
            {t('open')}
          </a>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={t('delete')}
        onClick={() => {
          void remove();
        }}
      >
        <Trash2Icon className="size-4 text-destructive" />
      </Button>
    </li>
  );
}
