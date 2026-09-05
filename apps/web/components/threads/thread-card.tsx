'use client';

import type { Thread } from '@trendhunter/types';
import { Badge, Button, Card, CardContent, toast } from '@trendhunter/ui';
import { CopyIcon, LanguagesIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * One thread, post by post.
 *
 * "Copy all" joins the posts with blank lines rather than copying them one at a
 * time, because that is how they are pasted into a composer.
 *
 * Translation is a whole-thread operation, never per post: the references
 * between posts, the hook and the closing payoff only make sense together, and
 * translating post by post is how a thread turns into a list of disconnected
 * sentences.
 */
export function ThreadCard({ thread }: { readonly thread: Thread }) {
  const t = useTranslations('threads');
  const common = useTranslations('common');
  const router = useRouter();
  const format = useFormatter();
  const [pending, setPending] = useState(false);

  const isArabic = thread.language === 'AR';

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setPending(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  async function copyAll(): Promise<void> {
    const text = thread.posts.map((post) => post.content).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(common('error'));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{thread.title}</p>
          <Badge variant="neutral">{t(`status.${thread.status}`)}</Badge>
          <Badge variant="blue">{thread.language}</Badge>
        </div>

        <ol className="space-y-3">
          {thread.posts.map((post) => (
            <li
              key={post.id}
              className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('post', { position: format.number(post.position) })}
                </span>
                <span className="tabular text-xs text-muted-foreground">
                  {t('characters', { count: format.number(post.characterCount) })}
                </span>
              </div>
              <p
                dir={isArabic ? 'rtl' : 'ltr'}
                lang={isArabic ? 'ar' : 'en'}
                className="text-sm whitespace-pre-wrap"
              >
                {post.content}
              </p>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void copyAll();
            }}
          >
            <CopyIcon className="size-4" />
            {t('copyAll')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              void run(
                () =>
                  browserFetch(`/threads/${thread.id}/translate`, {
                    method: 'POST',
                    body: { targetLanguage: 'AR' },
                  }),
                t('translated'),
              );
            }}
          >
            <LanguagesIcon className="size-4" />
            {t('translate')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={t('delete')}
            onClick={() => {
              void run(
                () => browserFetch(`/threads/${thread.id}`, { method: 'DELETE' }),
                t('deleted'),
              );
            }}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
