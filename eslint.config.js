import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'app/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,

      /* TypeScript resolves identifiers itself and does it better; leaving no-undef on only
         produces false positives for DOM globals inside page.evaluate callbacks. */
      'no-undef': 'off',

      /* `async ({}, testInfo) => …` is how Playwright hooks take testInfo without a fixture. */
      'no-empty-pattern': 'off',

      /* Test-suite specific rules. Each one exists because the mistake it catches is expensive. */

      // A floating promise in a test is a silently skipped assertion.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Sleeping is the most common cause of a suite that is both slow and flaky.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message: 'Do not sleep. Wait for a condition: expect().toBeVisible(), waitForResponse, or expect.poll.',
        },
      ],

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
];
