import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
// @ts-expect-error TS7016: .mjs has no type declarations under classic node resolution
import baseRules from '../eslint.base.config.mjs';

// Flat config replaces rule options, so the base selectors are re-added.
const [, ...baseRestrictedSyntax] = (
  baseRules as {
    'no-restricted-syntax': ['error', ...{ selector: string }[]];
  }
)['no-restricted-syntax'];

const KEYLESS_BODY_MESSAGE =
  'Send an error body with an errorKey, as the server does. If the server sends this body with no key, disable this line and give the reason.';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['**/*.ts'],
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
    rules: baseRules
  },
  // `basePath` keeps `src/**` relative to this workspace. The pre-commit hook
  // runs ESLint from the repository root, where `src/**` matches nothing; the
  // rule then reports each disable directive as unused and --fix deletes it.
  {
    basePath: __dirname,
    files: ['src/**/*.ts'],
    // The control routes drive the tests; they mirror no server route.
    ignores: ['src/__tests__/**', 'src/control.routes.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...baseRestrictedSyntax,
        {
          // Mirrors the keyless-exception check of the server config.
          selector:
            "CallExpression[callee.property.name='json'][callee.object.callee.property.name='status'][callee.object.arguments.0.value>=400] > ObjectExpression:not(:has(> Property[key.name='errorKey'])):not(:has(> SpreadElement))",
          message: KEYLESS_BODY_MESSAGE
        },
        {
          selector:
            "CallExpression[callee.name='sendError'][arguments.length<4]",
          message: KEYLESS_BODY_MESSAGE
        }
      ]
    }
  },
  prettierConfig
);
