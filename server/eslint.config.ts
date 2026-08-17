import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
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
    files: ['**/*.ts'],
    // TypeORM's bidirectional relations need the related class as a value inside
    // a lazily evaluated arrow, so `import type` is not available and the cycle
    // is inherent to the ORM. `scripts/check-imports.mjs` exempts them the same way.
    ignores: ['**/*.entity.ts'],
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
