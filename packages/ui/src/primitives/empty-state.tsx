import type * as React from 'react';

import { cn } from '../lib/cn';

export interface EmptyStateProps extends React.ComponentProps<'div'> {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
}

/**
 * What a panel shows when it has nothing to show.
 *
 * A distinct component rather than an inline "No results" string, because an
 * empty list and a failed request look identical to a user otherwise — this is
 * only ever rendered for a successful response that returned no rows.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon === undefined ? null : (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description === undefined ? null : (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
