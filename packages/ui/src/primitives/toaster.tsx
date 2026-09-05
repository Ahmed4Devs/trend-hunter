'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';
import type * as React from 'react';

/**
 * Transient notifications.
 *
 * Styled through the token classes rather than sonner's own theme prop so the
 * toast matches the surface it appears over in both themes — sonner's built-in
 * dark theme is its own palette, not ours.
 */
export function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      toastOptions={{
        classNames: {
          toast:
            'group flex items-center gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg',
          description: 'text-muted-foreground text-sm',
          actionButton: 'bg-primary text-primary-foreground rounded-md px-2 py-1 text-xs',
          cancelButton: 'bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs',
          error: 'text-destructive',
          success: 'text-primary',
        },
      }}
      {...props}
    />
  );
}

export { toast };
