import type { HttpErrorResponse } from '@angular/common/http';
import type { TranslocoService } from '@jsverse/transloco';

type ServerErrorBody = {
  message?: string | string[];
  errorKey?: string;
};

/**
 * Single funnel for turning a server error payload into a user-facing string.
 *
 * Resolution order:
 * 1. `errorKey` when it maps to an actual translation entry;
 * 2. `message` as a string array - the ValidationPipe shape, whose entries are
 *    raw English class-validator texts, so a generic translated message is used
 *    instead of leaking them (per-field errors are already rendered by forms);
 * 3. `fallbackKey` - a translated caller-specific message always beats the
 *    untranslated server text below it;
 * 4. `message` as a single string - server text, the last resort before the
 *    transport-level message / status code.
 */
export function parseHttpErrorMessage(
  error: HttpErrorResponse,
  transloco: TranslocoService,
  fallbackKey?: string
): string {
  const body =
    typeof error.error === 'object' && error.error !== null
      ? (error.error as ServerErrorBody)
      : null;

  if (body?.errorKey) {
    const translated = transloco.translate(body.errorKey);
    if (translated !== body.errorKey) {
      return translated;
    }
  }

  if (Array.isArray(body?.message)) {
    return transloco.translate('errors.general.validationFailed');
  }

  if (fallbackKey) {
    return transloco.translate(fallbackKey);
  }

  if (typeof body?.message === 'string' && body.message) {
    return body.message;
  }

  return error.message || `Error Code: ${error.status}`;
}
