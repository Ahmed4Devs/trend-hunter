import { Loader2Icon } from 'lucide-react';

import { cn } from '../lib/cn';

export interface SpinnerProps {
  readonly className?: string;
  /** Announced to assistive technology; required so it is never left untranslated. */
  readonly label: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <Loader2Icon className={cn('size-4 animate-spin text-muted-foreground', className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
