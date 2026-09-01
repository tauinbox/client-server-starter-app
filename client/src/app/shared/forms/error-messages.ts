/**
 * Default mapping from Angular validator error codes to Transloco i18n keys.
 *
 * `<nxs-form-field>` resolves an error key by checking:
 * 1. per-field `[errors]` input override
 * 2. this registry
 * 3. fallback `forms.errors.unknown`
 *
 * Keys are Signal Forms error kinds, which are camelCase (`minLength`), not
 * the lowercase codes of the older reactive-forms API. A miss here falls back
 * to `forms.errors.unknown`, which hides the real rule from the user.
 *
 * For `minLength` / `maxLength` the translation string receives the bound
 * value via interpolation params extracted from the validator error object.
 */
export const DEFAULT_ERROR_KEYS: Record<string, string> = {
  required: 'forms.errors.required',
  email: 'forms.errors.email',
  minLength: 'forms.errors.minLength',
  maxLength: 'forms.errors.maxLength',
  pattern: 'forms.errors.pattern',
  min: 'forms.errors.min',
  max: 'forms.errors.max',
  passwordWeak: 'forms.errors.passwordWeak',
  passwordMismatch: 'forms.errors.passwordMismatch'
};
