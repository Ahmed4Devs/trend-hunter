import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@trendhunter/ui';
import { RadarIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SignInForm } from '@/components/auth/sign-in-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signIn') };
}

export default async function SignInPage() {
  const t = await getTranslations('auth');

  return (
    <Card>
      <CardHeader className="flex-col items-center gap-3 pt-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <RadarIcon className="size-6" />
        </span>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('signInTitle')}</CardTitle>
          <CardDescription>{t('signInSubtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pb-8">
        <SignInForm />
      </CardContent>
    </Card>
  );
}
