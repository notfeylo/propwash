import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'public', 'assets-src', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.browser } },
  { files: ['tools/**/*.mjs', 'tests/**/*.ts', '*.config.*'], languageOptions: { globals: globals.node } },
);
