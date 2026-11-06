// At most 3 positional parameters. A constructor is exempt, because Nest and
// Angular inject each dependency through it; so is a Nest route handler, whose
// decorators bind each parameter, and the callback of `it.each(...)`, whose
// parameters are the columns of the table.
const MAX_PARAMS_MESSAGE =
  'Do not declare more than 3 positional parameters. Keep the subject of the call positional and put the other values in one options object.';
const maxParamsSyntax = [
  ":function[params.length>3]:not(MethodDefinition[kind='constructor'] > FunctionExpression, CallExpression[callee.callee.property.name='each'] > :function, MethodDefinition > FunctionExpression:has(Decorator))",
  'TSDeclareFunction[params.length>3]',
  'TSMethodSignature[params.length>3]',
  'TSFunctionType[params.length>3]',
  'TSEmptyBodyFunctionExpression[params.length>3]'
].map((selector) => ({ selector, message: MAX_PARAMS_MESSAGE }));

// The ES2025 forms (doc/architecture.md). The `unicorn` rules need the
// plugin registered in the config block that spreads these rules.
const es2025Rules = {
  'prefer-object-has-own': 'error',
  'unicorn/prefer-at': 'error',
  'unicorn/prefer-regexp-escape': 'error',
  'unicorn/prefer-promise-with-resolvers': 'error',
  'unicorn/prefer-iterator-helpers': 'error',
  'unicorn/prefer-structured-clone': 'error',
  'unicorn/prefer-string-replace-all': 'error',
  'unicorn/no-array-sort': 'error'
};

// `unicorn/prefer-promise-with-resolvers` sees only an executor with a block
// body, so this catches the arrow form `(resolve) => (release = resolve)`.
const promiseResolverSyntax = {
  selector:
    "NewExpression[callee.name='Promise'] > ArrowFunctionExpression.arguments[params.length=1][body.type='AssignmentExpression'][body.right.type='Identifier']",
  message:
    'Do not take the resolve function out of a Promise executor. Use Promise.withResolvers().'
};

// Prettier keeps blank lines but never adds one. These rules add the blank
// lines that separate the steps of a function. The `@stylistic` plugin must be
// registered in the config block that spreads these rules.
const blankLineRules = {
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: ['const', 'let'], next: '*' },
    { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
    {
      blankLine: 'always',
      prev: '*',
      next: ['if', 'for', 'while', 'do', 'try', 'switch']
    },
    {
      blankLine: 'always',
      prev: ['if', 'for', 'while', 'do', 'try', 'switch'],
      next: '*'
    }
  ],
  '@stylistic/lines-between-class-members': [
    'error',
    'always',
    { exceptAfterSingleLine: true }
  ]
};

export default {
  ...es2025Rules,
  ...blankLineRules,
  'object-shorthand': ['error', 'always'],
  // Declarations only: the assignment form `({ x } = obj);` reads worse than
  // `x = obj.x`.
  'prefer-destructuring': [
    'error',
    {
      VariableDeclarator: { array: true, object: true },
      AssignmentExpression: { array: false, object: false }
    }
  ],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }
  ],
  // Ban `x as unknown as T` double casts. Flat config replaces (does not merge)
  // this rule's options, so any config that declares its own no-restricted-syntax
  // must append this selector rather than rely on the value here.
  'no-restricted-syntax': [
    'error',
    {
      selector:
        'TSAsExpression > TSAsExpression.expression > TSUnknownKeyword.typeAnnotation',
      message:
        'Do not use `as unknown as T` double casts. Fix the type at its root (widen the parameter, use a typed partial mock), or use `// @ts-expect-error` in tests.'
    },
    promiseResolverSyntax,
    ...maxParamsSyntax
  ]
};
