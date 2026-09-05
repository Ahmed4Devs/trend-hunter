'use client';

import { cn } from '@trendhunter/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { isActivePath, NAVIGATION } from './navigation';

export interface SidebarNavProps {
  /** Closes the mobile drawer after a navigation. Absent on the desktop rail. */
  readonly onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {NAVIGATION.map((section) => (
        <div key={section.titleKey} className="space-y-1">
          <p className="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
            {t(section.titleKey)}
          </p>
          {section.items.map((item) => {
            const active = isActivePath(item.href, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                // `aria-current` rather than colour alone: the active item has
                // to be identifiable without perceiving the accent.
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
