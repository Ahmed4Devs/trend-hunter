'use client';

import type { Translation } from '@trendhunter/types';
import { Badge, Button, Card, CardContent, Separator, toast } from '@trendhunter/ui';
import { CopyIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * One translation, source beside result.
 *
 * The two panes carry their own `dir` and `lang` rather than inheriting the
 * interface's: the source is English and the result is Arabic no matter which
 * language the reader is using the product in, and inheriting would render one
 * of them backwards.
 */
export function TranslationCard({ translation }: { readonly translation: Translation }) {
  const t = useTranslations('translations');
  const common = useTranslations('common');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(translation.translatedContent);
      toast.success(t('copied'));
    } catch {
      // Clipboard access can be refused outright (permissions, an insecure
      // origin); saying so beats a button that silently does nothing.
      toast.error(common('error'));
    }
  }

  async function remove(): Promise<void> {
    setPending(true);
    try {
      await browserFetch(`/translations/${translation.id}`, { method: 'DELETE' });
      toast.success(t('deleted'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="purple">{t(`mode.${translation.mode}`)}</Badge>
          <Badge variant="neutral">{t(`targetKind.${translation.targetKind}`)}</Badge>
          <span className="text-xs text-muted-foreground">
            {t('provider', { provider: translation.providerName })}
          </span>
          <span className="ms-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('copy')}
              onClick={() => {
                void copy();
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
                void remove();
              }}
            >
              <Trash2Icon className="size-4 text-destructive" />
            </Button>
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('source')}</p>
            <p dir="ltr" lang="en" className="text-sm whitespace-pre-wrap">
              {translation.sourceContent}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('result')}</p>
            <p dir="rtl" lang="ar" className="text-sm leading-loose whitespace-pre-wrap">
              {translation.translatedContent}
            </p>
          </div>
        </div>

        {translation.preservedTerms.length === 0 ? null : (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('preserved')}</p>
            <div className="flex flex-wrap gap-1.5">
              {translation.preservedTerms.map((term) => (
                <Badge key={term} variant="neutral" dir="ltr">
                  {term}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {translation.explanation === null ? null : (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t('explanation')}</p>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {translation.explanation}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
