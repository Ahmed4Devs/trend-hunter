import eslintJs from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat configuration.
 *
 * The rules here are the ones that catch real defects in this codebase rather
 * than stylistic preferences — formatting is Prettier's job and
 * `eslint-config-prettier` disables every rule that would conflict with it.
 *
 * Type-aware linting is enabled through `projectService`, which is what makes
 * `no-floating-promises` and `no-misused-promises` work; those two catch the
 * single most common class of bug in an async Fastify/BullMQ codebase.
 */

/** Files that are never linted. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/generated/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/*.min.js',
  '**/next-env.d.ts',
];

/**
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig({ tsconfigRootDir }) {
  return tseslint.config(
    { ignores },

    eslintJs.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
      },
      rules: {
        // --- correctness -----------------------------------------------
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/await-thenable': 'error',
        '@typescript-eslint/require-await': 'error',
        '@typescript-eslint/no-unnecessary-condition': 'warn',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-console': ['error', { allow: ['warn', 'error'] }],
        'no-param-reassign': 'error',
        'prefer-const': 'error',
        'no-var': 'error',

        // --- type safety ------------------------------------------------
        // `any` is banned outright; `unknown` plus a Zod parse is the
        // supported way to handle untrusted data.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unsafe-assignment': 'error',
        '@typescript-eslint/no-unsafe-member-access': 'error',
        '@typescript-eslint/no-unsafe-call': 'error',
        '@typescript-eslint/no-unsafe-return': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            ignoreRestSiblings: true,
          },
        ],
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          { allowNumber: true, allowBoolean: false, allowNullish: false },
        ],

        // --- security ---------------------------------------------------
        // Every one of these is a way to execute a string as code.
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        'no-script-url': 'error',
        '@typescript-eslint/no-implied-eval': 'error',
      },
    },

    // Plain JavaScript — flat configs, build scripts, repository tooling. These
    // files are not part of any tsconfig project, so type-aware rules cannot
    // run against them and must be switched off explicitly.
    {
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
      rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        'no-console': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },

    // Tests may assert on values the type system cannot express.
    {
      files: ['**/*.test.{ts,tsx}', '**/tests/**/*.{ts,tsx}', '**/e2e/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/unbound-method': 'off',
        'no-console': 'off',
      },
    },

    prettierConfig,
  );
}

export default createBaseConfig;
