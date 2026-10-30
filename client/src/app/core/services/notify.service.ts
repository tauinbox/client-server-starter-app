import { inject, Injectable } from '@angular/core';
import { MatSnackBar, type MatSnackBarRef } from '@angular/material/snack-bar';
import type { TextOnlySnackBar } from '@angular/material/snack-bar';
import type { HttpErrorResponse } from '@angular/common/http';
import { TranslocoService } from '@jsverse/transloco';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';

type TranslationParams = Record<string, unknown>;
type NotifyRef = MatSnackBarRef<TextOnlySnackBar>;

/**
 * Centralised snackbar helper. Translates message keys via Transloco, uses a
 * translated close-action label, and relies on `MAT_SNACK_BAR_DEFAULT_OPTIONS`
 * for duration/position so call sites don't repeat config.
 *
 * `error()` accepts an HttpErrorResponse and resolves its text through the
 * shared `parseHttpErrorMessage` funnel.
 *
 * One refused request shows one message: the error interceptor reports
 * through `reportLater()`, and a caller that reports the same error first
 * wins.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  readonly #snackBar = inject(MatSnackBar);
  readonly #transloco = inject(TranslocoService);
  readonly #reported = new WeakSet<HttpErrorResponse>();

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
    this.#reported.add(source);
    return this.#open(
      parseHttpErrorMessage(source, this.#transloco, fallbackKey)
    );
  }

  /**
   * Shows the message of `error` unless a caller reports the same error
   * first. The callback runs in a macrotask, because the `catch` of an
   * `await firstValueFrom(...)` caller runs in a later microtask.
   */
  reportLater(error: HttpErrorResponse, show: () => void): void {
    setTimeout(() => {
      if (this.#reported.has(error)) return;
      this.#reported.add(error);
      show();
    });
  }

  /** For a caller that shows `error` in another way than `error()`. */
  markReported(error: HttpErrorResponse): void {
    this.#reported.add(error);
  }

  #open(message: string): NotifyRef {
    return this.#snackBar.open(
      message,
      this.#transloco.translate('common.close')
    );
  }
}
