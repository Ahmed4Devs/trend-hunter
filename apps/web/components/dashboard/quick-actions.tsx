import { Button, Card, CardContent, CardHeader, CardTitle } from '@trendhunter/ui';
import { BookmarkIcon, FileBarChartIcon, LanguagesIcon, SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { NewScanButton } from '@/components/layout/new-scan-button';

/**
 * The five things a reader most often wants to do next.
 *
 * Four are navigations and render as links; only "scan now" performs work, and
 * it reuses the header's button rather than duplicating the request logic —
 * two buttons that start scans differently is how one of them ends up wrong.
 */
export async function QuickActions() {
  const t = await getTranslations('dashboard.quickActions');

  const links = [
    { href: '/translations', labelKey: 'translatePosts', icon: LanguagesIcon },
    { href: '/saved', labelKey: 'saveToCollection', icon: BookmarkIcon },
    { href: '/reports', labelKey: 'generateReport', icon: FileBarChartIcon },
    { href: '/content', labelKey: 'createContent', icon: SparklesIcon },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <NewScanButton className="inline-flex" label={t('scanNow')} />
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Button key={link.href} asChild variant="outline" size="sm">
              <Link href={link.href}>
                <Icon className="size-4" />
                {t(link.labelKey)}
              </Link>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}
