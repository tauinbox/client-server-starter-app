import { validate, type SchemaPath } from '@angular/forms/signals';
import { exceedsPasswordByteLimit } from '@app/shared/utils/password-bytes';

/**
 * The bcrypt byte cap, for a field that SETS a password. `maxLength` counts
 * UTF-16 code units and cannot express it: a Cyrillic letter is two bytes, so
 * a 37-character Russian password is already over the limit while it is far
 * below any character cap.
 */
export function passwordByteLimit(
  path: SchemaPath<string>,
  message: string
): void {
  validate(path, ({ value }) =>
    exceedsPasswordByteLimit(value())
      ? { kind: 'passwordMaxBytes', message }
      : null
  );
}
