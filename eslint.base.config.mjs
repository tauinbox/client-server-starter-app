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

export default {
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
    ...maxParamsSyntax
  ]
};
