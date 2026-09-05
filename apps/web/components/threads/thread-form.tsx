'use client';

import {
  CONTENT_TONES,
  type ContentLanguage,
  type ContentTone,
  type Topic,
} from '@trendhunter/types';
import {
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from '@trendhunter/ui';
import { MessagesSquareIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/** Bounds the API enforces; repeated here so the control cannot ask for a rejected value. */
const MIN_LENGTH = 3;
const MAX_LENGTH = 25;

export function ThreadForm({ topics }: { readonly topics: readonly Topic[] }) {
  const t = useTranslations('threads');
  const content = useTranslations('content');
  const common = useTranslations('common');
  const router = useRouter();

  const [topicId, setTopicId] = useState(topics[0]?.id ?? '');
  const [length, setLength] = useState(6);
  const [tone, setTone] = useState<ContentTone>('NEUTRAL');
  const [language, setLanguage] = useState<ContentLanguage>('EN');
  const [pending, setPending] = useState(false);

  if (topics.length === 0) {
    return (
      <EmptyState icon={<MessagesSquareIcon className="size-5" />} title={content('noTopics')} />
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/threads', {
        method: 'POST',
        body: { topicId, length, tone, language },
      });
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
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:items-end"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="space-y-1.5 xl:col-span-2">
        <Label htmlFor="thread-topic">{content('topic')}</Label>
        <Select value={topicId} onValueChange={setTopicId}>
          <SelectTrigger id="thread-topic">
            <SelectValue placeholder={content('topicPlaceholder')} />
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
        <Label htmlFor="thread-length">{t('length')}</Label>
        <Input
          id="thread-length"
          type="number"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          value={length}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            setLength(Number.isFinite(parsed) ? parsed : MIN_LENGTH);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="thread-tone">{content('tone.label')}</Label>
        <Select
          value={tone}
          onValueChange={(value) => {
            setTone(value as ContentTone);
          }}
        >
          <SelectTrigger id="thread-tone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_TONES.map((value) => (
              <SelectItem key={value} value={value}>
                {content(`tone.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="thread-language">{content('language.label')}</Label>
        <Select
          value={language}
          onValueChange={(value) => {
            setLanguage(value as ContentLanguage);
          }}
        >
          <SelectTrigger id="thread-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EN">{content('language.EN')}</SelectItem>
            <SelectItem value="AR">{content('language.AR')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={pending || topicId === ''} className="xl:col-span-5 xl:w-fit">
        {pending ? <Spinner label={t('creating')} /> : <MessagesSquareIcon className="size-4" />}
        {t('create')}
      </Button>
    </form>
  );
}
