'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';
import type * as React from 'react';

/**
 * Light, dark and system, persisted.
 *
 * `attribute="class"` is what the design system's `dark` variant keys on, and
 * next-themes writes it from an inline script before first paint, so a reader
 * who chose dark never sees a white flash on navigation or reload.
 *
 * Transitions are disabled during the switch: without that, every element with
 * a colour transition animates at once and the change reads as a slow wash
 * rather than a toggle.
 */
export function ThemeProvider({ children }: { readonly children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="trendhunter.theme"
    >
      {children}
    </NextThemeProvider>
  );
}
