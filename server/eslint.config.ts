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
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    // The Express mock helpers return `Response & T`, so a mocked member carries
    // both the jest.Mock property and the original method declaration, and
    // `expect(res.cookie)` - the idiomatic Jest assertion - reads as an unbound
    // method reference. Every hit in test code is that pattern or a metadata
    // lookup off `Controller.prototype[name]`; neither ever calls the reference.
    rules: { '@typescript-eslint/unbound-method': 'off' }
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
  {
    files: ['src/**/*.ts'],
    rules: {
      // Flat config replaces rule options, so the base selectors are re-added.
      'no-restricted-syntax': [
        'error',
        ...(
          baseRules as {
            'no-restricted-syntax': ['error', ...{ selector: string }[]];
          }
        )['no-restricted-syntax'].slice(1),
        {
          selector: "CallExpression[callee.name='forwardRef']",
          message:
            'Do not use forwardRef() across a module boundary. Emit an EventEmitter2 event and handle it in a listener of the target module.'
        }
      ]
    }
  },
  {
    files: ['src/**/*.ts'],
    // CLI entry points that run outside Nest, so no logger exists there.
    ignores: [
      '**/*.spec.ts',
      'src/postgres-data-source.ts',
      'src/seed-admin.ts'
    ],
    rules: { 'no-console': 'error' }
  },
  prettierConfig
);
