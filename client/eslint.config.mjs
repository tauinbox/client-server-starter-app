// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';
import baseRules from '../eslint.base.config.mjs';

export default tseslint.config(
  {
    ignores: ['src/index.html']
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.angular/**',
      '.idea/**',
      '.run/**'
    ],
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
      prettier
    ],
    plugins: {
      prettier: prettierPlugin,
      'import-x': importX,
      unicorn,
      'unused-imports': unusedImportsPlugin
    },
    processor: angular.processInlineTemplates,
    rules: {
      ...baseRules,
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports'
        }
      ],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'nxs',
          style: 'camelCase'
        }
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'nxs',
          style: 'kebab-case'
        }
      ],
      'import-x/no-cycle': 'error',
      // Never compare a role.name against the raw 'admin' literal —
      // always go through SYSTEM_ROLES.ADMIN from @app/shared/constants so the
      // system role can be renamed without breaking client RBAC checks.
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='==='] > Literal[value='admin']",
          message:
            "Use SYSTEM_ROLES.ADMIN from '@app/shared/constants' instead of the 'admin' literal."
        },
        {
          selector: "BinaryExpression[operator='!=='] > Literal[value='admin']",
          message:
            "Use SYSTEM_ROLES.ADMIN from '@app/shared/constants' instead of the 'admin' literal."
        },
        {
          selector:
            "CallExpression[callee.property.name='includes'] > Literal[value='admin']",
          message:
            "Use SYSTEM_ROLES.ADMIN from '@app/shared/constants' instead of the 'admin' literal."
        },
        // Flat config replaces this rule's options, so the base selectors are
        // re-added here.
        ...baseRules['no-restricted-syntax'].slice(1),
        // RegExp modifiers are ES2025 syntax that Safari before 26 cannot
        // parse, and no other gate sees them: TypeScript accepts them at any
        // target, and the build copies the literal as it is.
        ...[
          'Literal[regex.pattern=/(?<!\\\\)\\(\\?(?:[ims]+-?[ims]*|-[ims]+):/]',
          "NewExpression[callee.name='RegExp'] > Literal.arguments[value=/(?<!\\\\)\\(\\?(?:[ims]+-?[ims]*|-[ims]+):/]",
          "CallExpression[callee.name='RegExp'] > Literal.arguments[value=/(?<!\\\\)\\(\\?(?:[ims]+-?[ims]*|-[ims]+):/]"
        ].map((selector) => ({
          selector,
          message:
            'Do not use RegExp modifiers such as (?i:...). Safari before 26 throws a SyntaxError on them, and client/.browserslistrc supports Safari 18.4. Use a flag on the whole pattern or a character class.'
        })),
        {
          // A server errorKey is only a translation key when a translation for
          // it exists; rendering it directly puts a raw dot-path on screen the
          // first time the server ships a key ahead of the client i18n file.
          selector:
            "CallExpression[callee.property.name='translate'] MemberExpression[property.name='errorKey']",
          message:
            'Do not translate a server errorKey directly. Route the whole HttpErrorResponse through parseHttpErrorMessage (or NotifyService.error), which falls back to the server message when the key has no translation.'
        },
        {
          selector:
            "CallExpression[callee.property.name='translate'] Identifier[name='errorKey']",
          message:
            'Do not translate a server errorKey directly. Route the whole HttpErrorResponse through parseHttpErrorMessage (or NotifyService.error), which falls back to the server message when the key has no translation.'
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(success|info|warn|error)$/][arguments.0.name='errorKey']",
          message:
            'Do not pass a server errorKey as a NotifyService message key. Pass the HttpErrorResponse itself and a client-owned fallback key.'
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(success|info|warn|error)$/][arguments.0.property.name='errorKey']",
          message:
            'Do not pass a server errorKey as a NotifyService message key. Pass the HttpErrorResponse itself and a client-owned fallback key.'
        },
        {
          // Playwright discourages networkidle: an open request can hang the
          // wait for the whole test timeout.
          selector:
            "CallExpression[callee.property.name='waitForLoadState'] > Literal[value='networkidle']",
          message:
            "Do not wait for 'networkidle'. Wait for the page content with a web assertion, for example expect(locator).toBeVisible()."
        },
        {
          selector:
            "Property[key.name='waitUntil'] > Literal[value='networkidle']",
          message:
            "Do not wait for 'networkidle'. Wait for the page content with a web assertion, for example expect(locator).toBeVisible()."
        }
      ]
    }
  },
  {
    settings: {
      // Without this the plugin cannot parse an imported .ts file under flat
      // config, builds an empty graph, and `import-x/no-cycle` silently passes
      // on everything. `npm run check:imports` is the workspace-independent
      // backstop for exactly that failure mode.
      'import-x/parsers': {
        '@typescript-eslint/parser': ['.ts']
      },
      'import-x/resolver-next': [
        createTypeScriptImportResolver(),
        createNodeResolver()
      ]
    }
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
      prettier
    ],
    plugins: {
      prettier: prettierPlugin
    },
    rules: {
      'prettier/prettier': 'error'
    }
  }
);
