'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@trendhunter/ui';
import { LanguagesIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { setLocale } from '@/app/actions/locale';
import { LOCALES } from '@/lib/locale';

/**
 * English / Arabic.
 *
 * The switch runs in a transition so the reader keeps the current page
 * interactive while the server re-renders it in the other language — a full
 * navigation would blank the view, and this changes the direction of the whole
 * layout, which is jarring enough without a flash of nothing.
 */
export function LocaleSwitcher() {
  const t = useTranslations('locale');
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('change')} disabled={pending}>
          <LanguagesIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            data-active={locale === current}
            className="data-[active=true]:text-primary"
            onSelect={() => {
              startTransition(async () => {
                await setLocale(locale);
              });
            }}
          >
            {t(locale)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
