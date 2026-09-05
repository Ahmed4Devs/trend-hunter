'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]',
        'data-[state=closed]:anim-fade-out data-[state=open]:anim-fade-in',
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** Hides the corner close button for a dialog that must be answered. */
  readonly hideClose?: boolean;
  readonly closeLabel: string;
  /**
   * Where the surface sits.
   *
   * `center` is a dialog. `panel` is a full-height sheet against the inline
   * start edge — a mobile navigation drawer. They need different positioning
   * *and* different motion: the centred entrance animates a
   * `translate(-50%, -50%)` transform, and applying that to a panel drags it
   * away from the edge mid-animation, which leaves the element never settling
   * and its links unclickable.
   */
  readonly variant?: 'center' | 'panel';
}

/**
 * The dialog body.
 *
 * `closeLabel` is required rather than defaulted to "Close": the button has an
 * icon and no text, so its accessible name is the only thing a screen reader
 * announces, and a hard-coded English default would ship untranslated.
 */
export function DialogContent({
  className,
  children,
  hideClose = false,
  closeLabel,
  variant = 'center',
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-variant={variant}
        className={cn(
          'fixed z-50 border border-border bg-card shadow-lg',
          variant === 'center' && [
            'top-1/2 left-1/2 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'gap-4 rounded-xl p-6',
            'data-[state=closed]:anim-pop-out data-[state=open]:anim-pop-in',
          ],
          variant === 'panel' && [
            'start-0 top-0 h-full w-72 max-w-[85vw] rounded-none border-s-0 border-e',
            'data-[state=closed]:anim-fade-out data-[state=open]:anim-fade-in',
          ],
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 rounded-sm opacity-70 ring-offset-background transition-opacity',
              'hover:opacity-100 disabled:pointer-events-none',
              // Logical inset: the close button follows the reading direction
              // instead of being pinned to the visual right in Arabic.
              'end-4',
            )}
          >
            <XIcon className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 text-start', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
