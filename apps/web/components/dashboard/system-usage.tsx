import type { ApiUsageSummary, SystemHealthSummary } from '@trendhunter/types';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
  Separator,
} from '@trendhunter/ui';
import { ActivityIcon, CircleIcon } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

export interface SystemUsageProps {
  readonly usage: readonly ApiUsageSummary[];
  readonly health: SystemHealthSummary;
}

/** Status colours are reserved for state and never reused as a series colour. */
const STATUS_TONE = {
  up: 'text-primary',
  stale: 'text-accent-orange',
  down: 'text-destructive',
} as const;

/**
 * Provider usage and service health.
 *
 * The status dots carry a written label beside them, always: a coloured dot on
 * its own says "something" to a reader who cannot separate the green from the
 * red, and this panel is the one a reader consults precisely when something is
 * wrong.
 */
export async function SystemUsage({ usage, health }: SystemUsageProps) {
  const t = await getTranslations('dashboard.usage');
  const h = await getTranslations('dashboard.health');
  const format = await getFormatter();

  const statuses = [
    { labelKey: 'database', state: health.database },
    { labelKey: 'redis', state: health.redis },
    { labelKey: 'worker', state: health.worker },
  ] as const;

  return (
    <Card className="h-full">
      <CardHeader className="flex-col items-start">
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          {statuses.map((status) => (
            <div key={status.labelKey} className="space-y-1">
              <p className="text-xs text-muted-foreground">{h(status.labelKey)}</p>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <CircleIcon
                  aria-hidden="true"
                  className={`size-2.5 ${STATUS_TONE[status.state]}`}
                  fill="currentColor"
                />
                {h(status.state)}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{h('queueDepth')}</p>
            <p className="tabular text-sm font-medium">{format.number(health.queueDepth)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{h('failedJobs')}</p>
            <p className="tabular text-sm font-medium">{format.number(health.failedJobs24h)}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {health.workerLastHeartbeatAt === null
            ? h('neverSeen')
            : h('lastHeartbeat', {
                time: format.relativeTime(new Date(health.workerLastHeartbeatAt)),
              })}
        </p>

        <Separator />

        {usage.length === 0 ? (
          <EmptyState icon={<ActivityIcon className="size-5" />} title={t('empty')} />
        ) : (
          <ul className="space-y-4">
            {usage.map((entry) => (
              <li key={`${entry.provider}:${entry.operation}`} className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{entry.provider}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {format.number(entry.requestCount)}
                  </span>
                </div>

                {entry.quotaUsedPercentage === null ? (
                  <p className="text-xs text-muted-foreground">{t('noQuota')}</p>
                ) : (
                  <>
                    <Progress
                      value={entry.quotaUsedPercentage}
                      aria-label={t('quota', {
                        used: format.number(entry.quotaUsedPercentage, {
                          maximumFractionDigits: 0,
                        }),
                      })}
                      indicatorClassName={
                        entry.quotaUsedPercentage >= 90 ? 'bg-destructive' : 'bg-primary'
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('quota', {
                        used: format.number(entry.quotaUsedPercentage, {
                          maximumFractionDigits: 0,
                        }),
                      })}
                    </p>
                  </>
                )}

                {entry.failureCount === 0 ? null : (
                  <Badge variant="red" className="tabular">
                    {t('failures')} {format.number(entry.failureCount)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
