'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import type * as React from 'react';

import { cn } from '../lib/cn';

export interface ProgressProps extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  /** Overrides the bar colour; defaults to the brand green. */
  readonly indicatorClassName?: string;
}

/**
 * A determinate progress bar, also used for quota and score meters.
 *
 * The indicator is translated rather than width-animated: a transform is
 * composited, so a row of meters does not force a layout pass each frame.
 */
export function Progress({ className, value, indicatorClassName, ...props }: ProgressProps) {
  const percent = Math.min(100, Math.max(0, value ?? 0));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('bg-muted relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('bg-primary h-full w-full flex-1 transition-transform', indicatorClassName)}
        style={{ transform: `translateX(${String(-100 + percent)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
