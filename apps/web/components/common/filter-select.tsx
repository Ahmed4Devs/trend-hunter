'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trendhunter/ui';

import { useQueryState } from './use-query-state';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterSelectProps {
  readonly paramName: string;
  readonly label: string;
  readonly options: readonly FilterOption[];
  /** Label for the "no filter" entry. */
  readonly anyLabel: string;
  readonly className?: string;
}

/**
 * A single-choice filter bound to one query parameter.
 *
 * The "any" entry carries a sentinel value rather than an empty string: Radix
 * treats an empty value as "no selection" and would render the placeholder
 * instead of the option the reader actually chose.
 */
const ANY = '__any__';

export function FilterSelect({
  paramName,
  label,
  options,
  anyLabel,
  className,
}: FilterSelectProps) {
  const { params, setParams } = useQueryState();
  const current = params.get(paramName) ?? ANY;

  return (
    <Select
      value={current}
      onValueChange={(value) => {
        setParams({ [paramName]: value === ANY ? null : value });
      }}
    >
      <SelectTrigger aria-label={label} className={className ?? 'w-44'}>
        <SelectValue placeholder={anyLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
