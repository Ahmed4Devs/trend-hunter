'use client';

import { Button, toast } from '@trendhunter/ui';
import { BookmarkIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

export interface SavePostButtonProps {
  readonly postId: string;
  readonly initiallySaved: boolean;
}

/**
 * The save toggle.
 *
 * Optimistic: the icon fills the moment it is pressed, because the reader is
 * scanning a list and a 200ms wait per item makes the whole list feel broken.
 * A failure puts the previous state back and says so, rather than leaving the
 * interface claiming something the server did not do.
 */
export function SavePostButton({ postId, initiallySaved }: SavePostButtonProps) {
  const t = useTranslations('dashboard.recent');
  const common = useTranslations('common');
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, setPending] = useState(false);

  async function toggle(): Promise<void> {
    const next = !saved;
    setSaved(next);
    setPending(true);

    try {
      if (next) {
        await browserFetch('/saved', { method: 'POST', body: { kind: 'POST', postId } });
      } else {
        await browserFetch('/saved/target', {
          method: 'DELETE',
          query: { kind: 'POST', postId },
        });
      }
      // The saved-items KPI and the saved page both count this.
      router.refresh();
    } catch (error) {
      setSaved(!next);
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? t('unsave') : t('save')}
      onClick={() => {
        void toggle();
      }}
      className={saved ? 'text-primary' : 'text-muted-foreground'}
    >
      <BookmarkIcon className="size-4" fill={saved ? 'currentColor' : 'none'} />
    </Button>
  );
}
