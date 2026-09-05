'use client';

import type { AuthenticatedUser } from '@trendhunter/types';
import { Button, Input, Label, Spinner, toast } from '@trendhunter/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { browserFetch } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';

/**
 * Name and avatar.
 *
 * The email address is shown but not editable. Changing it would have to
 * re-verify the address and invalidate every session bound to the old one, and
 * a field that silently does neither is worse than no field.
 */
export function ProfileForm({ user }: { readonly user: AuthenticatedUser }) {
  const t = useTranslations('settings.profile');
  const common = useTranslations('common');
  const router = useRouter();

  const [name, setName] = useState(user.name);
  const [image, setImage] = useState(user.image ?? '');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    try {
      await browserFetch('/settings/profile', {
        method: 'PATCH',
        body: { name, image: image.trim() === '' ? null : image.trim() },
      });
      toast.success(t('saved'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : common('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="profile-name">{t('name')}</Label>
        <Input
          id="profile-name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="profile-email">{t('email')}</Label>
        <Input id="profile-email" value={user.email} readOnly disabled dir="ltr" />
        <p className="text-xs text-muted-foreground">{t('emailNote')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="profile-image">{t('image')}</Label>
        <Input
          id="profile-image"
          type="url"
          dir="ltr"
          value={image}
          onChange={(event) => {
            setImage(event.target.value);
          }}
        />
      </div>

      <Button type="submit" disabled={pending || name.trim() === ''}>
        {pending ? <Spinner label={common('loading')} /> : null}
        {t('save')}
      </Button>
    </form>
  );
}
