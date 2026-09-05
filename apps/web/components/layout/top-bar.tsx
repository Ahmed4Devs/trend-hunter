'use client';

import type { AuthenticatedUser } from '@trendhunter/types';
import { Button } from '@trendhunter/ui';
import { BellIcon, MenuIcon } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';

import { GlobalSearch } from './global-search';
import { LocaleSwitcher } from './locale-switcher';
import { NewScanButton } from './new-scan-button';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export interface TopBarProps {
  readonly user: AuthenticatedUser;
  readonly onOpenMenu: () => void;
}

export function TopBar({ user, onOpenMenu }: TopBarProps) {
  const nav = useTranslations('nav');
  const header = useTranslations('header');
  const format = useFormatter();
  // The date is rendered from a client-side clock, so a session left open
  // overnight does not keep showing yesterday.
  const now = useNow({ updateInterval: 60_000 });

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={nav('openMenu')}
        onClick={onOpenMenu}
      >
        <MenuIcon className="size-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <GlobalSearch />
      </div>

      {/* Hidden below `xl`: the date is context, and it is the first thing that
          should give way to the controls when space runs out. */}
      <span className="hidden text-sm text-muted-foreground xl:inline">
        {format.dateTime(now, { dateStyle: 'medium' })}
      </span>

      <NewScanButton />

      <Button variant="ghost" size="icon" aria-label={header('notifications')}>
        <BellIcon className="size-4" />
      </Button>

      <ThemeToggle />
      <LocaleSwitcher />
      <UserMenu user={user} />
    </header>
  );
}
