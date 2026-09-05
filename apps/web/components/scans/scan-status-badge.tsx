import type { JobStatus } from '@trendhunter/types';
import { Badge } from '@trendhunter/ui';
import { getTranslations } from 'next-intl/server';

/**
 * Status colours are reserved for state, never reused as a series colour.
 * Running is deliberately blue rather than green: green means "finished well",
 * and a run still in flight has not earned it.
 */
const STATUS_VARIANT: Record<JobStatus, 'neutral' | 'blue' | 'green' | 'red' | 'orange'> = {
  PENDING: 'neutral',
  RUNNING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  CANCELLED: 'orange',
};

export async function ScanStatusBadge({ status }: { readonly status: JobStatus }) {
  const t = await getTranslations('scans.status');
  return <Badge variant={STATUS_VARIANT[status]}>{t(status)}</Badge>;
}
