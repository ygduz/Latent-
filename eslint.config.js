import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'test-results',
      'playwright-report',
      // Scratch files kept out of git (see .gitignore).
      '**/*.local.*',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      // A leading underscore marks something deliberately unused, and omitting
      // a key by destructuring it away is a legitimate way to drop it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    files: ['src/app/**/*.{ts,tsx}', 'src/main.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // --- Architectural boundary -------------------------------------------
  // The engine is the product. It must stay embeddable (white-label play),
  // which means it may use browser APIs but must never depend on the React
  // shell or on app-level state. This rule is the enforcement, not a comment.
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'src/engine must stay framework-free so it can be embedded.',
            },
            {
              name: 'react-dom',
              message: 'src/engine must stay framework-free so it can be embedded.',
            },
          ],
          patterns: [
            {
              group: ['**/app/**', '**/app'],
              message: 'The engine must not depend on the React shell. Dependencies point app -> engine only.',
            },
          ],
        },
      ],
    },
  },
);
