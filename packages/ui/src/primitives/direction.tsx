'use client';

/**
 * Radix's reading-direction provider, re-exported.
 *
 * Radix does not read `dir` from the document: `useDirection` falls back to
 * `'ltr'` when no provider is present. Without this at the root of the tree, an
 * Arabic session would still get a dropdown that opens to the right and arrow
 * keys that move the wrong way, even though the page itself is `dir="rtl"`.
 */
export { DirectionProvider } from '@radix-ui/react-direction';
