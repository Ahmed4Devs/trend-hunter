import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@trendhunter/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { TabLinks } from '@/components/common/tab-links';
import { ProfileForm } from '@/components/settings/profile-form';
import { requireCurrentUser } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.profile');
  return { title: t('title') };
}

export default async function ProfileSettingsPage() {
  const user = await requireCurrentUser();
  const t = await getTranslations('settings');
  const profile = await getTranslations('settings.profile');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <TabLinks
        label={t('title')}
        tabs={[
          { href: '/settings', label: t('tabs.preferences'), active: false },
          { href: '/settings/profile', label: t('tabs.profile'), active: true },
        ]}
      />

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>{profile('title')}</CardTitle>
          <CardDescription>{profile('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm user={user} />
        </CardContent>
      </Card>
    </div>
  );
}
