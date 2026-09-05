import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // The integration suite talks to PostgreSQL; give it room to connect,
    // migrate state and tear down without a spurious timeout.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
