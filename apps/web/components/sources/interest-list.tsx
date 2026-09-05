'use client';

import type { Interest } from '@trendhunter/types';
import { Badge, Button, EmptyState, toast } from '@trendhunter/ui';
import { TargetIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

export function InterestList({ interests }: { readonly interests: readonly Interest[] }) {
  const t = useTranslations('sources.interests');
  const common = useTranslations('common');
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(id: string): Promise<void> {
    setRemoving(id);
    try {
      await browserFetch(`/interests/${id}`, { method: 'DELETE' });
      toast.success(t('deleted'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setRemoving(null);
    }
  }

  if (interests.length === 0) {
    return (
      <EmptyState
        icon={<TargetIcon className="size-5" />}
        title={t('empty')}
        description={t('emptyHint')}
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {interests.map((interest) => (
        <li key={interest.id} className="flex items-start gap-3 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium">{interest.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {interest.keywords.map((keyword) => (
                <Badge key={keyword.id} variant="neutral">
                  {keyword.keyword}
                </Badge>
              ))}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={removing === interest.id}
            aria-label={t('delete')}
            onClick={() => {
              void remove(interest.id);
            }}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
