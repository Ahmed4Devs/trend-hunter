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

  {
    // The browser tests are Node programs that drive a browser; they are not
    // part of the application's TypeScript project, and the rules written for
    // application code do not describe them. They get their own tsconfig so
    // type-aware linting still works, and two rules are turned off because
    // they are about the app, not about a test runner:
    //
    //   * `process.env` is how a test run is parameterised — there is no
    //     application environment to read here;
    //   * Playwright's fixture API names its callback argument `use`, which the
    //     React hooks rule sees as a hook called outside a component.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.e2e.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-properties': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]);
