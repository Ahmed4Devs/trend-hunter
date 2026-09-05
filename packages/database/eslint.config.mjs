import { createNodeConfig } from '@trendhunter/config/eslint/node';

export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The integration suite is gated on a real DATABASE_URL, which it has to
    // read directly: @trendhunter/env would refuse the test environment.
    files: ['tests/integration.test.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
];
