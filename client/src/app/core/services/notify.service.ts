import { inject, Injectable } from '@angular/core';
import { MatSnackBar, type MatSnackBarRef } from '@angular/material/snack-bar';
import type { TextOnlySnackBar } from '@angular/material/snack-bar';
import type { HttpErrorResponse } from '@angular/common/http';
import { TranslocoService } from '@jsverse/transloco';

type TranslationParams = Record<string, unknown>;
type NotifyRef = MatSnackBarRef<TextOnlySnackBar>;

/**
 * Centralised snackbar helper. Translates message keys via Transloco, uses a
 * translated close-action label, and relies on `MAT_SNACK_BAR_DEFAULT_OPTIONS`
 * for duration/position so call sites don't repeat config.
 *
 * `error()` accepts an HttpErrorResponse and replicates the parsing in
 * `errorInterceptor.getErrorMessageText` (errorKey → translated, then
 * server-provided message, then HTTP status fallback).
 */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  readonly #snackBar = inject(MatSnackBar);
  readonly #transloco = inject(TranslocoService);

  success(messageKey: string, params?: TranslationParams): NotifyRef {
    return this.#open(this.#transloco.translate(messageKey, params));
  }

  info(messageKey: string, params?: TranslationParams): NotifyRef {
    return this.#open(this.#transloco.translate(messageKey, params));
  }

  warn(messageKey: string, params?: TranslationParams): NotifyRef {
    return this.#open(this.#transloco.translate(messageKey, params));
  }

  /**
   * String form: translate `messageKey` with optional params.
   * HttpErrorResponse form: prefer the server-provided `errorKey` (translated)
   * or `message`, otherwise translate the optional `fallbackKey`, else use
   * `e.message` / status code as a last resort.
   */
  error(messageKey: string, params?: TranslationParams): NotifyRef;
  error(httpError: HttpErrorResponse, fallbackKey?: string): NotifyRef;
  error(
    source: string | HttpErrorResponse,
    paramsOrFallbackKey?: TranslationParams | string
  ): NotifyRef {
    if (typeof source === 'string') {
      return this.#open(
        this.#transloco.translate(
          source,
          paramsOrFallbackKey as TranslationParams | undefined
        )
      );
    }
    const fallbackKey =
      typeof paramsOrFallbackKey === 'string' ? paramsOrFallbackKey : undefined;
    return this.#open(this.#parseHttpError(source, fallbackKey));
  }

  #open(message: string): NotifyRef {
    return this.#snackBar.open(
      message,
      this.#transloco.translate('common.close')
    );
  }

  #parseHttpError(e: HttpErrorResponse, fallbackKey?: string): string {
    if (typeof e.error === 'object' && e.error !== null) {
      const errorObj = e.error as { message?: string; errorKey?: string };

      if (errorObj.errorKey) {
        const translated = this.#transloco.translate(errorObj.errorKey);
        if (translated !== errorObj.errorKey) {
          return translated;
        }
      }

      if (errorObj.message) {
        return errorObj.message;
      }
    }

    if (fallbackKey) {
      return this.#transloco.translate(fallbackKey);
    }

    return e.message || `Error Code: ${e.status}`;
  }
}
