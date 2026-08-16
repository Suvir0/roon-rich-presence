import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', '**/coverage/**'] },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['website/**/*.js'],
    languageOptions: { globals: globals.browser }
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: ['./apps/desktop/tsconfig.json', './packages/core/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }]
    }
  }
);
