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
    }
  ]
};
