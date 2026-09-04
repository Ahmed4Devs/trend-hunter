import { createReactConfig } from '@trendhunter/config/eslint/react';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * ESLint configuration for the Next.js application.
 *
 * Composes the shared React rules with Next's own Core Web Vitals and
 * TypeScript presets.
 */
export default defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
  ]),

  ...createReactConfig({ tsconfigRootDir: import.meta.dirname }),
  ...nextVitals,
  ...nextTs,

  {
    settings: {
      // pnpm's isolated node_modules layout hides react from
      // eslint-plugin-react's directory walk, so the version is stated here.
      react: { version: '19.2' },
    },
  },
]);
