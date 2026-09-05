import { cn } from '@trendhunter/ui';
import Link from 'next/link';

export interface TabLink {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
}

/**
 * Tabs that are links.
 *
 * Each panel is rendered by the server from a different endpoint, so switching
 * is a navigation, not a client-side toggle. Links also give the reader the
 * things a div cannot: middle-click, a shareable URL, and a back button that
 * returns to the tab they were on.
 */
export function TabLinks({
  tabs,
  label,
}: {
  readonly tabs: readonly TabLink[];
  readonly label: string;
}) {
  return (
    <nav aria-label={label} className="inline-flex items-center rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1 text-sm font-medium transition-colors',
            tab.active
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
