import { createNodeConfig } from '@trendhunter/config/eslint/node';

/**
 * Root ESLint configuration.
 *
 * Each workspace package owns its own `eslint.config.mjs` so that type-aware
 * linting resolves the right tsconfig project. This root config only covers
 * repository-level scripts and configuration files.
 */
export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    ignores: ['apps/**', 'packages/**', 'docker/**', 'context/**'],
  },
];
