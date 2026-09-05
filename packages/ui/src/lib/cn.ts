import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names, letting a later Tailwind utility beat an earlier one in
 * the same group.
 *
 * Plain concatenation does not: `class="p-2 p-4"` leaves the winner to CSS
 * source order, so a caller passing `p-4` to a component whose base is `p-2`
 * gets whichever Tailwind emitted last. `twMerge` resolves it by group.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
