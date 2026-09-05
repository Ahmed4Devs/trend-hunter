'use client';

import { Input } from '@trendhunter/ui';
import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useQueryState } from './use-query-state';

export interface SearchFieldProps {
  readonly paramName?: string;
  readonly placeholder: string;
  readonly label: string;
}

/**
 * A filter box that writes to the URL.
 *
 * The input is controlled locally and the URL is written on a delay, so typing
 * stays responsive: navigating per keystroke would re-run the query on every
 * character and make the field feel like it is fighting the reader.
 */
export function SearchField({ paramName = 'search', placeholder, label }: SearchFieldProps) {
  const { params, setParams } = useQueryState();
  const committed = params.get(paramName) ?? '';
  const [value, setValue] = useState(committed);

  useEffect(() => {
    if (value === committed) return;

    const timer = setTimeout(() => {
      setParams({ [paramName]: value === '' ? null : value });
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [value, committed, paramName, setParams]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        className="ps-9"
      />
    </div>
  );
}
