'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@trendhunter/ui';
import { AlertTriangleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * The error boundary for every route below it.
 *
 * It shows the digest and nothing else. Next replaces a server error's message
 * with an opaque digest in production precisely so that a stack trace or a
 * database message cannot reach a browser, and rendering `error.message` here
 * would undo that in development while looking correct.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations('errors');
  const common = useTranslations('common');

  useEffect(() => {
    // The browser console is the one place this is useful and safe: it is the
    // reader's own session, and the server has already logged the real cause.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-col items-center gap-3 pt-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
            <AlertTriangleIcon className="size-6" />
          </span>
          <div className="space-y-1">
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          {error.digest === undefined ? null : (
            <p className="font-mono text-xs text-muted-foreground">
              {t('requestId', { id: error.digest })}
            </p>
          )}
          <Button onClick={reset}>{common('retry')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
