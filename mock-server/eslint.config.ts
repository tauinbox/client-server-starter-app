import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
// @ts-expect-error TS7016: .mjs has no type declarations under classic node resolution
import baseRules from '../eslint.base.config.mjs';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['**/*.ts'],
    plugins: { import: importPlugin },
    settings: {
      // Without this the plugin cannot parse an imported .ts file under flat
      // config, builds an empty graph, and the rule below passes on everything.
      'import/parsers': { '@typescript-eslint/parser': ['.ts'] },
      'import/resolver': { typescript: true, node: true }
    },
    rules: { 'import/no-cycle': 'error' }
  },
  {
    rules: baseRules
  },
  prettierConfig
);
