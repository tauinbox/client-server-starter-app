import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import baseRules from '../eslint.base.config.mjs';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    rules: baseRules
  },
  prettierConfig
);
