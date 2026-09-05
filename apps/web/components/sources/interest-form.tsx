'use client';

import { Button, Input, Label, toast } from '@trendhunter/ui';
import { PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * Adds an interest.
 *
 * Keywords are entered as a comma-separated string and split here rather than
 * as a repeatable field: this is the shape people already have in their head,
 * and the API takes the list either way.
 */
export function InterestForm() {
  const t = useTranslations('sources.interests');
  const common = useTranslations('common');
  const router = useRouter();

  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/interests', {
        method: 'POST',
        body: {
          name,
          keywords: keywords
            .split(',')
            .map((keyword) => keyword.trim())
            .filter((keyword) => keyword !== '')
            .map((keyword) => ({ keyword })),
        },
      });
      setName('');
      setKeywords('');
      toast.success(t('created'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="interest-name">{t('name')}</Label>
        <Input
          id="interest-name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="interest-keywords">{t('keywords')}</Label>
        <Input
          id="interest-keywords"
          placeholder={t('keywordsHint')}
          value={keywords}
          onChange={(event) => {
            setKeywords(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={pending || name.trim() === ''}>
        <PlusIcon className="size-4" />
        {t('add')}
      </Button>
    </form>
  );
}
