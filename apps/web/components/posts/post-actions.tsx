'use client';

import { Button, toast } from '@trendhunter/ui';
import { CheckIcon, EyeOffIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

export interface PostActionsProps {
  readonly postId: string;
  readonly isRead: boolean;
  readonly isHidden: boolean;
}

/**
 * Read and hidden flags.
 *
 * Both are server state on the post rather than a local preference, so they are
 * written through the API and the page is refreshed — a locally toggled flag
 * would disagree with the list the reader returns to.
 */
export function PostActions({ postId, isRead, isHidden }: PostActionsProps) {
  const t = useTranslations('posts.detail');
  const common = useTranslations('common');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function update(body: Record<string, boolean>): Promise<void> {
    setPending(true);
    try {
      await browserFetch(`/posts/${postId}`, { method: 'PATCH', body });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          void update({ isRead: !isRead });
        }}
      >
        <CheckIcon className="size-4" />
        {isRead ? t('markUnread') : t('markRead')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          void update({ isHidden: !isHidden });
        }}
      >
        <EyeOffIcon className="size-4" />
        {isHidden ? t('unhide') : t('hide')}
      </Button>
    </>
  );
}
