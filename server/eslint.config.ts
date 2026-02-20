import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
// @ts-expect-error TS7016: .mjs has no type declarations under classic node resolution
import baseRules from '../eslint.base.config.mjs';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname
      }
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked]
  },
  globalIgnores(['dist/**', 'node_modules/**', 'coverage/**', 'public/**']),
  {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    rules: {
      ...baseRules,
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  prettierConfig
);
