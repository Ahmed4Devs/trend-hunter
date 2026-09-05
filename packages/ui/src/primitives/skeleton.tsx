import type * as React from 'react';

import { cn } from '../lib/cn';

/**
 * A loading placeholder.
 *
 * Sized by the caller to match the content it stands in for, so the layout
 * does not jump when the real value arrives.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
