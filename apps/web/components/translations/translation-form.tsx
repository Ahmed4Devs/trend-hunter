'use client';

import {
  TERMINOLOGY_PREFERENCES,
  TRANSLATION_MODES,
  type TerminologyPreference,
  type TranslationMode,
} from '@trendhunter/types';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Textarea,
  toast,
} from '@trendhunter/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * Free-text translation.
 *
 * Mode and terminology preference are exposed rather than hidden behind a
 * default, because they are the whole product decision here: the same English
 * sentence becomes a different Arabic sentence depending on whether it is going
 * into a thread or a reference document, and on whether "embedding" should stay
 * in Latin script.
 */
export function TranslationForm() {
  const t = useTranslations('translations');
  const common = useTranslations('common');
  const router = useRouter();

  const [text, setText] = useState('');
  const [mode, setMode] = useState<TranslationMode>('X_STYLE');
  const [terminology, setTerminology] = useState<TerminologyPreference>(
    'KEEP_COMMON_ENGLISH_TERMS',
  );
  const [explain, setExplain] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/translations', {
        method: 'POST',
        body: {
          targetKind: 'FREEFORM',
          text,
          targetLanguage: 'AR',
          mode,
          terminologyPreference: terminology,
          explain,
        },
      });
      setText('');
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
      className="space-y-4"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="translation-text">{t('text')}</Label>
        <Textarea
          id="translation-text"
          required
          maxLength={20_000}
          rows={5}
          dir="ltr"
          placeholder={t('textPlaceholder')}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="translation-mode">{t('mode.label')}</Label>
          <Select
            value={mode}
            onValueChange={(value) => {
              setMode(value as TranslationMode);
            }}
          >
            <SelectTrigger id="translation-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSLATION_MODES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`mode.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="translation-terminology">{t('terminology.label')}</Label>
          <Select
            value={terminology}
            onValueChange={(value) => {
              setTerminology(value as TerminologyPreference);
            }}
          >
            <SelectTrigger id="translation-terminology">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINOLOGY_PREFERENCES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`terminology.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="translation-explain" className="flex items-center gap-2">
          <Switch id="translation-explain" checked={explain} onCheckedChange={setExplain} />
          {t('explain')}
        </Label>

        <Button type="submit" disabled={pending || text.trim() === ''}>
          {pending ? <Spinner label={t('submitting')} /> : t('submit')}
        </Button>
      </div>
    </form>
  );
}
