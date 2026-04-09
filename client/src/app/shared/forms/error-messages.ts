/**
 * Default mapping from Angular validator error codes to Transloco i18n keys.
 *
 * `<app-form-field>` resolves an error key by checking:
 * 1. per-field `[errors]` input override
 * 2. this registry
 * 3. fallback `forms.errors.unknown`
 *
 * For `minlength` / `maxlength` the translation string receives
 * `{{ requiredLength }}` via interpolation params extracted from the
 * validator error object.
 */
export const DEFAULT_ERROR_KEYS: Record<string, string> = {
  required: 'forms.errors.required',
  email: 'forms.errors.email',
  minlength: 'forms.errors.minlength',
  maxlength: 'forms.errors.maxlength',
  pattern: 'forms.errors.pattern',
  min: 'forms.errors.min',
  max: 'forms.errors.max',
  passwordWeak: 'forms.errors.passwordWeak',
  passwordMismatch: 'forms.errors.passwordMismatch'
};
