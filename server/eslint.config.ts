import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
// @ts-expect-error TS7016: .mjs has no type declarations under classic node resolution
import baseRules from '../eslint.base.config.mjs';

type RestrictedSyntax = { selector: string; message: string };

// Flat config replaces rule options, so the base selectors are re-added.
const [, ...baseRestrictedSyntax] = (
  baseRules as {
    'no-restricted-syntax': ['error', ...RestrictedSyntax[]];
  }
)['no-restricted-syntax'];
const restrictedSyntax: RestrictedSyntax[] = [
  ...baseRestrictedSyntax,
  {
    selector: "CallExpression[callee.name='forwardRef']",
    message:
      'Do not use forwardRef() across a module boundary. Emit an EventEmitter2 event and handle it in a listener of the target module.'
  }
];

// The client shows a server message as it is when no errorKey comes with it,
// so a body without a key reaches a Russian user in English. A selector cannot
// see the type of an identifier: a message held in a variable is not caught.
const KEYLESS_EXCEPTION_MESSAGE =
  'Throw an HTTP exception with a { message, errorKey } body. Add the key to ErrorKeys and to both client i18n files. If no user can see the text, disable this line and give the reason.';
const keylessExceptionSyntax: RestrictedSyntax[] = [
  {
    selector:
      'NewExpression[callee.name=/Exception$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]',
    message: KEYLESS_EXCEPTION_MESSAGE
  },
  {
    selector: 'NewExpression[callee.name=/Exception$/][arguments.length=0]',
    message: KEYLESS_EXCEPTION_MESSAGE
  }
];

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
    plugins: { 'import-x': importX },
    settings: {
      // Without this the plugin cannot parse an imported .ts file under flat
      // config, builds an empty graph, and the rule below passes on everything.
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts'] },
      'import-x/resolver-next': [
        createTypeScriptImportResolver(),
        createNodeResolver()
      ]
    },
    rules: { 'import-x/no-cycle': 'error' }
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
  // `basePath` keeps `src/**` relative to this workspace. The pre-commit hook
  // runs ESLint from the repository root, where `src/**` matches nothing; the
  // rule then reports each disable directive as unused and --fix deletes it.
  {
    basePath: __dirname,
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        ...keylessExceptionSyntax
      ]
    }
  },
  {
    basePath: __dirname,
    files: ['src/**/*.spec.ts'],
    rules: { 'no-restricted-syntax': ['error', ...restrictedSyntax] }
  },
  {
    basePath: __dirname,
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
