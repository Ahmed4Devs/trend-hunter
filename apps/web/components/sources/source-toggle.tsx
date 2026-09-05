'use client';

import { Switch, toast } from '@trendhunter/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

export interface SourceToggleProps {
  readonly sourceId: string;
  readonly enabled: boolean;
  /** False for a non-administrator: the control is shown, disabled, not hidden. */
  readonly canEdit: boolean;
}

/**
 * Enables or disables collection for one source.
 *
 * A non-administrator sees the switch disabled rather than absent, so the state
 * of the system is still legible to them — hiding it would leave them unable to
 * tell a disabled source from one that does not exist. The API refuses the
 * write regardless of what this component renders.
 */
export function SourceToggle({ sourceId, enabled, canEdit }: SourceToggleProps) {
  const t = useTranslations('sources');
  const common = useTranslations('common');
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, setPending] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    setChecked(next);
    setPending(true);
    try {
      await browserFetch(`/sources/${sourceId}`, { method: 'PATCH', body: { enabled: next } });
      router.refresh();
    } catch (error) {
      setChecked(!next);
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Switch
      checked={checked}
      disabled={!canEdit || pending}
      aria-label={t('toggle')}
      onCheckedChange={(next) => {
        void toggle(next);
      }}
    />
  );
}
