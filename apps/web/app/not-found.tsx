import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@trendhunter/ui';
import { CompassIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('errors');

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-col items-center gap-3 pt-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CompassIcon className="size-6" />
          </span>
          <div className="space-y-1">
            <CardTitle>{t('notFoundTitle')}</CardTitle>
            <CardDescription>{t('notFoundDescription')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex justify-center pb-8">
          <Button asChild>
            <Link href="/">{t('backToDashboard')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
