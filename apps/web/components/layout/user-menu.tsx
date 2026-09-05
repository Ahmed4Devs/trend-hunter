'use client';

import type { AuthenticatedUser } from '@trendhunter/types';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@trendhunter/ui';
import { LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { signOut } from '@/lib/auth-client';

/**
 * Initials for the avatar fallback.
 *
 * Taken by code point, not by UTF-16 unit: a name beginning with a character
 * outside the basic plane would otherwise contribute half a surrogate pair and
 * render as a replacement glyph.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts
    .map((part) => {
      const codePoint = part.codePointAt(0);
      return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
    })
    .join('');
  return initials === '' ? '?' : initials.toUpperCase();
}

export function UserMenu({ user }: { readonly user: AuthenticatedUser }) {
  const t = useTranslations('auth');
  const header = useTranslations('header');
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    await signOut();
    // A full refresh, not a push: the session cookie has just been cleared, and
    // the router cache still holds pages rendered for the signed-in user.
    router.refresh();
    router.replace('/sign-in');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={header('userMenu')}>
          <Avatar>
            {user.image === null ? null : <AvatarImage src={user.image} alt="" />}
            <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-sm font-normal text-foreground">
          <span className="block truncate font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          <Badge variant={user.role === 'ADMIN' ? 'purple' : 'neutral'} className="mt-2">
            {user.role === 'ADMIN' ? t('roleAdmin') : t('roleUser')}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            router.push('/settings/profile');
          }}
        >
          <UserIcon />
          {t('profile')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            router.push('/settings');
          }}
        >
          <SettingsIcon />
          {t('account')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onSelect={(event) => {
            // The menu closes on select, which would unmount this before the
            // request finishes; holding it open until sign-out resolves is what
            // makes the disabled state visible.
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOutIcon />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
