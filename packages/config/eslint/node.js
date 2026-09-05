import globals from 'globals';

import { createBaseConfig } from './base.js';

/**
 * Configuration for Node.js services and libraries.
 *
 * The extra rules here exist to keep server code from leaking into the browser
 * bundle and to make process-level mistakes visible.
 *
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createNodeConfig({ tsconfigRootDir }) {
  return [
    ...createBaseConfig({ tsconfigRootDir }),
    {
      files: ['**/*.{ts,mts,cts}'],
      languageOptions: {
        globals: { ...globals.node, ...globals.es2024 },
      },
      rules: {
        // `process.env` is read in exactly one place: @trendhunter/env.
        // Everywhere else it hides configuration and defeats validation.
        'no-restricted-properties': [
          'error',
          {
            object: 'process',
            property: 'env',
            message: 'Read configuration through @trendhunter/env so it is validated and typed.',
          },
        ],
        'no-restricted-globals': [
          'error',
          {
            name: '__dirname',
            message: 'Use import.meta.dirname; this package is ESM.',
          },
          {
            name: '__filename',
            message: 'Use import.meta.filename; this package is ESM.',
          },
        ],
      },
    },
  ];
}

export default createNodeConfig;
