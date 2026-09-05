'use client';

import {
  CONTENT_DRAFT_KINDS,
  CONTENT_TONES,
  type ContentDraftKind,
  type ContentLanguage,
  type ContentTone,
  type Topic,
} from '@trendhunter/types';
import {
  Button,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  toast,
} from '@trendhunter/ui';
import { SparklesIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * Generates a draft from a topic.
 *
 * A topic is required rather than optional. Generation without one produces
 * text about nothing in particular, which is the failure mode that makes an AI
 * writing tool feel like a novelty; every draft here is anchored to something
 * the pipeline actually collected.
 */
export function GenerateForm({ topics }: { readonly topics: readonly Topic[] }) {
  const t = useTranslations('content');
  const common = useTranslations('common');
  const router = useRouter();

  const [topicId, setTopicId] = useState(topics[0]?.id ?? '');
  const [kind, setKind] = useState<ContentDraftKind>('SHORT_X_POST');
  const [tone, setTone] = useState<ContentTone>('NEUTRAL');
  const [language, setLanguage] = useState<ContentLanguage>('EN');
  const [instructions, setInstructions] = useState('');
  const [pending, setPending] = useState(false);

  if (topics.length === 0) {
    return <EmptyState icon={<SparklesIcon className="size-5" />} title={t('noTopics')} />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/content/generate', {
        method: 'POST',
        body: {
          kind,
          topicId,
          language,
          tone,
          ...(instructions.trim() === '' ? {} : { instructions: instructions.trim() }),
        },
      });
      setInstructions('');
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="content-topic">{t('topic')}</Label>
          <Select value={topicId} onValueChange={setTopicId}>
            <SelectTrigger id="content-topic">
              <SelectValue placeholder={t('topicPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {topics.map((topic) => (
                <SelectItem key={topic.id} value={topic.id}>
                  {topic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-kind">{t('kind.label')}</Label>
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as ContentDraftKind);
            }}
          >
            <SelectTrigger id="content-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_DRAFT_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`kind.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-tone">{t('tone.label')}</Label>
          <Select
            value={tone}
            onValueChange={(value) => {
              setTone(value as ContentTone);
            }}
          >
            <SelectTrigger id="content-tone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_TONES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`tone.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="content-language">{t('language.label')}</Label>
          <Select
            value={language}
            onValueChange={(value) => {
              setLanguage(value as ContentLanguage);
            }}
          >
            <SelectTrigger id="content-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EN">{t('language.EN')}</SelectItem>
              <SelectItem value="AR">{t('language.AR')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content-instructions">{t('instructions')}</Label>
        <Textarea
          id="content-instructions"
          rows={2}
          maxLength={500}
          placeholder={t('instructionsPlaceholder')}
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value);
          }}
        />
      </div>

      <Button type="submit" disabled={pending || topicId === ''}>
        {pending ? <Spinner label={t('generating')} /> : <SparklesIcon className="size-4" />}
        {t('generate')}
      </Button>
    </form>
  );
}
