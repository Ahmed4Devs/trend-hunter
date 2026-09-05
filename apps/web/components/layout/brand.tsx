import { RadarIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The wordmark.
 *
 * The mark is an icon rather than an image so it inherits the accent colour in
 * both themes and needs no second asset for dark mode.
 */
export function Brand() {
  const t = useTranslations('app');
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <RadarIcon className="size-4.5" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">{t('name')}</span>
        <span className="text-[0.6875rem] text-muted-foreground">{t('tagline')}</span>
      </span>
    </div>
  );
}
