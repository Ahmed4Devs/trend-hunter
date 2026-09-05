import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web application.
 *
 * `e2e/` is excluded explicitly. Vitest's default include matches `*.spec.ts`
 * as well as `*.test.ts`, so without this it collects the Playwright specs and
 * fails on `test.describe` from a runner that is not Playwright — an error
 * message that names neither the real problem nor the file that caused it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts', 'components/**/*.test.ts?(x)'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
