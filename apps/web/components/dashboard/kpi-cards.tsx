import type { KpiCard as KpiCardModel } from '@trendhunter/types';
import { Card, CardContent } from '@trendhunter/ui';
import {
  BookmarkIcon,
  FolderTreeIcon,
  LanguagesIcon,
  type LucideIcon,
  MinusIcon,
  NewspaperIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  ZapIcon,
} from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

/** Icon and accent per KPI, keyed so a new KPI is a deliberate addition. */
const KPI_PRESENTATION: Record<string, { readonly icon: LucideIcon; readonly tint: string }> = {
  newTopics: { icon: FolderTreeIcon, tint: 'bg-accent-blue/12 text-accent-blue' },
  newPosts: { icon: NewspaperIcon, tint: 'bg-accent-purple/12 text-accent-purple' },
  relevantIdeas: { icon: ZapIcon, tint: 'bg-primary/12 text-primary' },
  savedItems: { icon: BookmarkIcon, tint: 'bg-accent-orange/12 text-accent-orange' },
  emergingTrends: { icon: SparklesIcon, tint: 'bg-accent-red/12 text-accent-red' },
  arabicOpportunities: { icon: LanguagesIcon, tint: 'bg-accent-green/12 text-accent-green' },
};

/**
 * The six headline numbers.
 *
 * A stat tile rather than a chart: each of these is one number whose job is to
 * be read, and a bar of six single values is a worse way to read six values.
 *
 * The change indicator carries an arrow as well as a colour, because "up" must
 * survive a reader who cannot distinguish the green from the red. When the
 * previous window was empty the API sends `null` rather than a percentage —
 * growth from zero is not a percentage — and the card says so instead of
 * rendering an infinity.
 */
export async function KpiCards({ kpis }: { readonly kpis: readonly KpiCardModel[] }) {
  const t = await getTranslations('dashboard.kpi');
  const format = await getFormatter();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {kpis.map((kpi) => {
        const presentation = KPI_PRESENTATION[kpi.key] ?? {
          icon: ZapIcon,
          tint: 'bg-muted text-muted-foreground',
        };
        const Icon = presentation.icon;
        const change = kpi.changePercentage;
        const rising = change !== null && change > 0;
        const falling = change !== null && change < 0;
        const ChangeIcon = rising ? TrendingUpIcon : falling ? TrendingDownIcon : MinusIcon;

        return (
          <Card key={kpi.key}>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">{t(kpi.key)}</span>
                <span
                  aria-hidden="true"
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${presentation.tint}`}
                >
                  <Icon className="size-4" />
                </span>
              </div>

              <p className="tabular text-2xl font-semibold tracking-tight">
                {format.number(kpi.value)}
              </p>

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ChangeIcon
                  aria-hidden="true"
                  className={`size-3.5 ${
                    rising ? 'text-primary' : falling ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                />
                {change === null ? (
                  <span>{t('noChange')}</span>
                ) : (
                  <>
                    <span className="tabular font-medium text-foreground">
                      {format.number(Math.abs(change) / 100, {
                        style: 'percent',
                        maximumFractionDigits: 1,
                      })}
                    </span>
                    <span>{t('versusPrevious')}</span>
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
