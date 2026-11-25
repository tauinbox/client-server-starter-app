import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import baseRules, { errorKeyLiteralSyntax } from '../eslint.base.config.mjs';

type RestrictedSyntax = { selector: string; message: string };

// Flat config replaces rule options, so the base selectors are re-added.
const [, ...baseRestrictedSyntax] = baseRules['no-restricted-syntax'];
// synchronize changes every schema that an entity names, the settings schema
// of a shared database included, and drops each index that no entity declares.
const synchronizeSyntax: RestrictedSyntax = {
  selector: "Property[key.name='synchronize'][value.value=true]",
  message:
    'Change the schema with a migration. A test that needs synchronize runs it on a database of its own: disable this line and name that database.'
};
const restrictedSyntax: RestrictedSyntax[] = [
  ...baseRestrictedSyntax,
  errorKeyLiteralSyntax,
  synchronizeSyntax,
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

// ERROR_STATUS holds the one status of each key, and ApiError reads it. A body
// built by hand can pair a key with another status, so it is refused.
const API_ERROR_MESSAGE =
  'Throw new ApiError(ErrorKeys.X.Y, message). It takes the status from ERROR_STATUS, so a key has one status on every route.';
const handBuiltErrorSyntax: RestrictedSyntax[] = [
  {
    selector: "ObjectExpression > Property[key.name='errorKey']",
    message: API_ERROR_MESSAGE
  },
  {
    selector:
      "NewExpression[callee.name=/Exception$/][arguments.0.type='ObjectExpression']",
    message: API_ERROR_MESSAGE
  }
];

// These UsersService methods take no ability, because each caller selects the
// record by a key the server holds: a token hash, a signed token, a refresh
// row or an event payload. A controller holds a client-chosen id, so it reads
// a user through findOne(id, ability), which runs the instance check.
const uncheckedUserLookupSyntax: RestrictedSyntax[] = [
  {
    selector:
      'CallExpression[callee.object.property.name=/^users?Service$/][callee.property.name=/^(findById|findByIdWithDeleted|findByEmail|incrementFailedAttemptsAndLockIfNeeded|upgradePasswordHash|resetLoginAttempts|setEmailVerificationToken|findByEmailVerificationToken|markEmailVerified|setPasswordResetToken|findByPasswordResetToken|clearPendingEmailChange|declareResidence)$/]',
    message:
      'This UsersService method takes no ability and runs no instance check. In a controller, use a method that takes an ability, such as findOne(id, ability). If the server, not the client, chose the key, disable this line and give the reason.'
  }
];

// A plain ConfigService falls back to process.env for a key the test did not
// give, so the result depends on the shell or the CI job env.
const isolatedConfigSyntax: RestrictedSyntax[] = [
  {
    selector: "NewExpression[callee.name='ConfigService']",
    message:
      'Use isolatedConfig(values) from src/common/testing/isolated-config. A plain ConfigService reads process.env for a key that the test did not give.'
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
    // `basePath` for the pre-commit run from the repository root (see below).
    basePath: __dirname,
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
    plugins: { unicorn, '@stylistic': stylistic },
    rules: {
      ...baseRules,
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  // After the block above, which turns on three type-aware rules for every
  // file: a script in JavaScript has no type information.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node }
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
        ...keylessExceptionSyntax,
        ...handBuiltErrorSyntax
      ]
    }
  },
  {
    basePath: __dirname,
    files: ['src/**/*.controller.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        ...keylessExceptionSyntax,
        ...handBuiltErrorSyntax,
        ...uncheckedUserLookupSyntax
      ]
    }
  },
  {
    // The factory itself, and the filter that writes the response envelope.
    basePath: __dirname,
    files: [
      'src/common/errors/api-error.ts',
      'src/modules/core/filters/global-exception.filter.ts'
    ],
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
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        ...isolatedConfigSyntax
      ]
    }
  },
  {
    basePath: __dirname,
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...baseRestrictedSyntax,
        errorKeyLiteralSyntax,
        ...isolatedConfigSyntax,
        synchronizeSyntax
      ]
    }
  },
  {
    // The data source of a repository token changes when an entity moves
    // between data sources; repositoryToken(entity) reads it from the list.
    basePath: __dirname,
    files: ['src/**/*.spec.ts', 'test/**/*.ts'],
    ignores: ['src/common/testing/repository-token.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/typeorm',
              importNames: ['getRepositoryToken'],
              message:
                'Use repositoryToken(entity) from src/common/testing/repository-token. It picks the data source of the entity.'
            }
          ]
        }
      ]
    }
  },
  {
    // A migration is applied history, and Prettier skips this folder too.
    basePath: __dirname,
    files: ['src/migrations/**/*.ts'],
    rules: {
      '@stylistic/padding-line-between-statements': 'off',
      '@stylistic/lines-between-class-members': 'off'
    }
  },
  {
    basePath: __dirname,
    files: ['src/**/*.ts'],
    // The boot steps run outside Nest, so no logger exists there.
    ignores: [
      '**/*.spec.ts',
      'src/seed-admin.ts',
      'src/run-boot-steps.ts',
      'src/run-migrations.ts'
    ],
    rules: { 'no-console': 'error' }
  },
  prettierConfig
);
