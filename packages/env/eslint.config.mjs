import { createNodeConfig } from '@trendhunter/config/eslint/node';

export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // This package IS the single sanctioned reader of process.env: every other
    // package is forbidden from touching it and must import from here instead.
    files: ['src/index.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
];
