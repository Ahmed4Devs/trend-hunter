import { createNodeConfig } from '@trendhunter/config/eslint/node';

export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The entry point writes to stderr directly: a configuration failure
    // happens before the logger exists.
    files: ['src/main.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
