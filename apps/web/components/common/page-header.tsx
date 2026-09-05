import type { ReactNode } from 'react';

export interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}

/** The heading every page opens with, so the h1 is never forgotten or duplicated. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description === undefined ? null : (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
