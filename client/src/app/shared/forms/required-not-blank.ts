import type { SchemaPath } from '@angular/forms/signals';
import { required, requiredError, validate } from '@angular/forms/signals';

/**
 * `required` that also refuses a value of spaces only. The built-in rule
 * treats only `''` as empty, so `'   '` passes it, is trimmed on submit and
 * reaches a server DTO that trims and then refuses an empty string.
 */
export function requiredNotBlank(
  path: SchemaPath<string>,
  options?: { message: string }
): void {
  required(path, options);
  validate(path, ({ value }) =>
    value() !== '' && value().trim() === '' ? requiredError(options) : undefined
  );
}
