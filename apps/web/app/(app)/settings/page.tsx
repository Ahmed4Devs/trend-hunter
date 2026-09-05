import type { UserSettings } from '@trendhunter/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@trendhunter/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { TabLinks } from '@/components/common/tab-links';
import { PreferencesForm } from '@/components/settings/preferences-form';
import { apiData } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default async function SettingsPage() {
  const settings = await apiData<UserSettings>('/settings');
  const t = await getTranslations('settings');
  const preferences = await getTranslations('settings.preferences');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <TabLinks
        label={t('title')}
        tabs={[
          { href: '/settings', label: t('tabs.preferences'), active: true },
          { href: '/settings/profile', label: t('tabs.profile'), active: false },
        ]}
      />

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>{preferences('title')}</CardTitle>
          <CardDescription>{preferences('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
