'use client';

import { REPORT_KINDS, type ReportKind } from '@trendhunter/types';
import {
  Button,
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
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/** `yyyy-mm-dd` for a date input, from a day offset. */
function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Requests a report over a date range.
 *
 * The dates are sent as full instants covering whole days: a range typed as
 * two dates means "from the start of the first to the end of the last", and
 * sending midnight for both ends would silently drop the final day.
 */
export function ReportForm() {
  const t = useTranslations('reports');
  const common = useTranslations('common');
  const router = useRouter();

  const [kind, setKind] = useState<ReportKind>('POSTS_COLLECTED');
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/reports', {
        method: 'POST',
        body: {
          kind,
          range: {
            from: new Date(`${from}T00:00:00.000Z`).toISOString(),
            to: new Date(`${to}T23:59:59.999Z`).toISOString(),
          },
        },
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
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-end"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="space-y-1.5 xl:col-span-2">
        <Label htmlFor="report-kind">{t('kind.label')}</Label>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value as ReportKind);
          }}
        >
          <SelectTrigger id="report-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`kind.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="report-from">{t('from')}</Label>
        <Input
          id="report-from"
          type="date"
          value={from}
          max={to}
          onChange={(event) => {
            setFrom(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="report-to">{t('to')}</Label>
        <Input
          id="report-to"
          type="date"
          value={to}
          min={from}
          onChange={(event) => {
            setTo(event.target.value);
          }}
        />
      </div>

      <Button type="submit" disabled={pending} className="xl:col-span-4 xl:w-fit">
        {pending ? <Spinner label={t('generating')} /> : null}
        {t('generate')}
      </Button>
    </form>
  );
}
