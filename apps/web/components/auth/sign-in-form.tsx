'use client';

import { Button, Input, Label, Spinner } from '@trendhunter/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { signIn } from '@/lib/auth-client';

/**
 * Email and password.
 *
 * Every failure renders the same message. Distinguishing "no such account" from
 * "wrong password" turns the form into an account-enumeration oracle, and the
 * only failure worth naming separately is the rate limit, because that one the
 * reader can actually act on by waiting.
 */
export function SignInForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Where to go after signing in.
   *
   * Only a path from this application is accepted. `next` comes from the query
   * string, so anything absolute — or protocol-relative, which `//evil.test`
   * is — would be an open redirect that phishes a freshly signed-in session.
   */
  function safeNextPath(): string {
    const requested = searchParams.get('next');
    if (requested === null) return '/';
    if (!requested.startsWith('/') || requested.startsWith('//')) return '/';
    return requested;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn.email({ email, password });

    if (result.error !== null) {
      setError(result.error.status === 429 ? t('rateLimited') : t('invalidCredentials'));
      setSubmitting(false);
      return;
    }

    // `refresh` first: the layout above is a Server Component that already
    // rendered for an anonymous caller, and pushing without invalidating it
    // would land on a cached shell with no user.
    router.refresh();
    router.replace(safeNextPath());
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          dir="ltr"
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <Spinner label={t('submitting')} /> : t('submit')}
      </Button>
    </form>
  );
}
