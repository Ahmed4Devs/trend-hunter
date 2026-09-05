'use client';

import { Button, toast } from '@trendhunter/ui';
import { PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * Starts a collection run across every enabled source.
 *
 * The response is the scan run, not its results: collection is queued work that
 * takes minutes, so the reader is sent to the scan's page to watch it rather
 * than left waiting on a request that would time out first.
 */
export interface NewScanButtonProps {
  /** Overrides the header's wording where the button appears under its own heading. */
  readonly label?: string;
  readonly className?: string;
}

export function NewScanButton({ label, className }: NewScanButtonProps) {
  const t = useTranslations('header');
  const common = useTranslations('common');
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function startScan(): Promise<void> {
    setStarting(true);
    try {
      const response = await browserFetch<{ id: string }>('/scans', {
        method: 'POST',
        body: {},
      });
      router.push(`/scans/${response.data.id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Button
      size="sm"
      disabled={starting}
      onClick={() => {
        void startScan();
      }}
      className={className ?? 'hidden sm:inline-flex'}
    >
      <PlusIcon className="size-4" />
      {label ?? t('newScan')}
    </Button>
  );
}
