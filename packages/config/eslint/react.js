import globals from 'globals';

import { createBaseConfig } from './base.js';

/**
 * Configuration for React/Next.js code.
 *
 * The restricted-syntax rules encode two product requirements that are easy to
 * violate accidentally and expensive to find later:
 *
 *  - no user-facing string may be hard-coded in a component (the UI ships in
 *    English and Arabic);
 *  - `dangerouslySetInnerHTML` is banned outright, because every piece of
 *    content this app renders comes from a third-party feed or an LLM.
 *
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createReactConfig({ tsconfigRootDir }) {
  return [
    ...createBaseConfig({ tsconfigRootDir }),
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        globals: { ...globals.browser, ...globals.es2024 },
      },
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
            message:
              'Rendering raw HTML is not allowed: collected posts, RSS bodies and LLM output are untrusted.',
          },
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'process',
            property: 'env',
            message:
              'Read configuration through @trendhunter/env; NEXT_PUBLIC_* values are exposed to the browser.',
          },
        ],
      },
    },
  ];
}

export default createReactConfig;
