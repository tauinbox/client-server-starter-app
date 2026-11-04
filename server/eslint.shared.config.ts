import path from 'node:path';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
// @ts-expect-error TS7016: .mjs has no type declarations under classic node resolution
import * as base from '../eslint.base.config.mjs';

// ESLint ignores a file outside the directory it runs in, so this runs from
// the repository root.
export default defineConfig({
  basePath: path.resolve(__dirname, '..'),
  files: ['shared/src/**/*.ts'],
  languageOptions: { parser: tseslint.parser },
  plugins: { '@typescript-eslint': tseslint.plugin, unicorn },
  rules: {
    ...base.es2025Rules,
    '@typescript-eslint/no-explicit-any':
      base.default['@typescript-eslint/no-explicit-any'],
    'no-restricted-syntax': ['error', base.promiseResolverSyntax]
  }
});
