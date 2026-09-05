'use client';

import type { ContentDraft } from '@trendhunter/types';
import { Badge, Button, Card, CardContent, Textarea, toast } from '@trendhunter/ui';
import { CopyIcon, PencilIcon, RefreshCwIcon, Trash2Icon, WandSparklesIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * One draft, editable in place.
 *
 * A rewrite creates a new draft rather than replacing this one — that is the
 * API's behaviour and the right one: an expansion promotes a short post to a
 * long one and a retone changes the tone, neither of which an edit records, and
 * keeping the original is what makes a rewrite the user dislikes recoverable.
 */
export function DraftCard({ draft }: { readonly draft: ContentDraft }) {
  const t = useTranslations('content');
  const common = useTranslations('common');
  const router = useRouter();
  const format = useFormatter();

  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(draft.content);
  const [pending, setPending] = useState(false);

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

  const isArabic = draft.language === 'AR';

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="purple">{t(`kind.${draft.kind}`)}</Badge>
          <Badge variant="neutral">{t(`status.${draft.status}`)}</Badge>
          <Badge variant="blue">{draft.language}</Badge>
          <span className="tabular text-xs text-muted-foreground">
            {t('characters', { count: format.number(draft.characterCount) })}
          </span>
          <span className="text-xs text-muted-foreground">{draft.providerName}</span>
        </div>

        {draft.title === null ? null : <p className="text-sm font-semibold">{draft.title}</p>}

        {editing ? (
          <Textarea
            rows={6}
            value={content}
            dir={isArabic ? 'rtl' : 'ltr'}
            onChange={(event) => {
              setContent(event.target.value);
            }}
          />
        ) : (
          <p
            dir={isArabic ? 'rtl' : 'ltr'}
            lang={isArabic ? 'ar' : 'en'}
            className="text-sm whitespace-pre-wrap"
          >
            {draft.content}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  void run(
                    () =>
                      browserFetch(`/content/drafts/${draft.id}`, {
                        method: 'PATCH',
                        body: { content },
                      }),
                    t('updated'),
                  ).then(() => {
                    setEditing(false);
                  });
                }}
              >
                {t('save')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setContent(draft.content);
                  setEditing(false);
                }}
              >
                {common('cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                <PencilIcon className="size-4" />
                {t('edit')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void run(
                    () =>
                      browserFetch(`/content/drafts/${draft.id}/rewrite`, {
                        method: 'POST',
                        body: { operation: 'rewrite' },
                      }),
                    t('rewritten'),
                  );
                }}
              >
                <WandSparklesIcon className="size-4" />
                {t('rewrite')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void run(
                    () =>
                      browserFetch(`/content/drafts/${draft.id}/regenerate`, { method: 'POST' }),
                    t('created'),
                  );
                }}
              >
                <RefreshCwIcon className="size-4" />
                {t('regenerate')}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('copy')}
                onClick={() => {
                  void navigator.clipboard.writeText(draft.content).then(
                    () => {
                      toast.success(t('copied'));
                    },
                    () => {
                      toast.error(common('error'));
                    },
                  );
                }}
              >
                <CopyIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={t('delete')}
                onClick={() => {
                  void run(
                    () => browserFetch(`/content/drafts/${draft.id}`, { method: 'DELETE' }),
                    t('deleted'),
                  );
                }}
              >
                <Trash2Icon className="size-4 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
