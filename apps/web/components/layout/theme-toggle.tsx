'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@trendhunter/ui';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';

/**
 * Light / dark / system.
 *
 * Both icons are always rendered and cross-faded by the `dark` variant rather
 * than picked from `resolvedTheme`. Reading the resolved theme would mean
 * rendering nothing until the client knows which one it is, which is a visible
 * pop on every load.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('toggle')}>
          <SunIcon className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
          <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            setTheme('light');
          }}
        >
          <SunIcon />
          {t('light')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setTheme('dark');
          }}
        >
          <MoonIcon />
          {t('dark')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setTheme('system');
          }}
        >
          <MonitorIcon />
          {t('system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
