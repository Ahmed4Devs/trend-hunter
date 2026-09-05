import type * as React from 'react';

import { cn } from '../lib/cn';

/**
 * The surface every panel sits on.
 *
 * A hairline border carries the edge in both themes, and the shadow is dropped
 * in dark mode: a shadow over a near-black background is invisible, so a dark
 * UI built on elevation shadows reads as one flat plane.
 *
 * `min-w-0` is load-bearing. A grid or flex item defaults to a minimum size of
 * its own content, so a single truncated title — `truncate` sets
 * `white-space: nowrap` — widens its whole track to the untruncated string and
 * the page scrolls sideways on a phone. Cards are always laid out by a parent,
 * so the floor belongs here rather than at each call site that happens to
 * notice.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-sm dark:shadow-none',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-3 px-5 pt-5 pb-3', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-base leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Sits in the header's inline-end corner: a "View all" link, a menu, a range picker. */
export function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2 border-t border-border px-5 py-3', className)}
      {...props}
    />
  );
}
