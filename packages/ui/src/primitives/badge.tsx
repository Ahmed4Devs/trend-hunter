import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../lib/cn';

/**
 * A small status label.
 *
 * The tinted variants lay a translucent accent over the surface rather than
 * using a second hand-picked pastel, so one definition stays legible in both
 * themes instead of needing a dark-mode counterpart per colour.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        neutral: 'border-border bg-muted text-muted-foreground',
        blue: 'border-transparent bg-accent-blue/15 text-accent-blue',
        green: 'border-transparent bg-accent-green/15 text-accent-green',
        orange: 'border-transparent bg-accent-orange/15 text-accent-orange',
        purple: 'border-transparent bg-accent-purple/15 text-accent-purple',
        red: 'border-transparent bg-accent-red/15 text-accent-red',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
