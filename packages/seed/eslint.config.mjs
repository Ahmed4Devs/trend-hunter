import { createNodeConfig } from '@trendhunter/config/eslint/node';

export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The seed is a script: it reports progress on stdout and reads the
    // environment directly, because it runs before any service exists.
    files: ['src/seed.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },
];
