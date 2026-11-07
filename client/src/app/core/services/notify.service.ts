import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { HttpErrorResponse } from '@angular/common/http';
import { TranslocoService } from '@jsverse/transloco';
import { catchError, forkJoin, of, take } from 'rxjs';
import { TRANSLATION_SCOPES } from '@core/transloco-loader';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';

type TranslationParams = Record<string, unknown>;

/**
 * Centralised snackbar helper. Translates message keys via Transloco, uses a
 * translated close-action label, and relies on `MAT_SNACK_BAR_DEFAULT_OPTIONS`
 * for duration/position so call sites don't repeat config.
 *
 * A message opens after the active language and the scope of its key are
 * loaded, so a message shown on a fresh page load never shows a raw key.
 * When two messages wait, the one that was asked for last stays on screen.
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
  #requested = 0;
  #opened = 0;

  success(messageKey: string, params?: TranslationParams): void {
    this.#showKey(messageKey, params);
  }

  info(messageKey: string, params?: TranslationParams): void {
    this.#showKey(messageKey, params);
  }

  warn(messageKey: string, params?: TranslationParams): void {
    this.#showKey(messageKey, params);
  }

  /**
   * String form: translate `messageKey` with optional params.
   * HttpErrorResponse form: prefer the server-provided `errorKey` (translated)
   * or `message`, otherwise translate the optional `fallbackKey`, else use
   * `e.message` / status code as a last resort.
   */
  error(messageKey: string, params?: TranslationParams): void;
  error(httpError: HttpErrorResponse, fallbackKey?: string): void;
  error(
    source: string | HttpErrorResponse,
    paramsOrFallbackKey?: TranslationParams | string
  ): void {
    if (typeof source === 'string') {
      this.#showKey(
        source,
        paramsOrFallbackKey as TranslationParams | undefined
      );

      return;
    }

    const fallbackKey =
      typeof paramsOrFallbackKey === 'string' ? paramsOrFallbackKey : undefined;

    this.#reported.add(source);

    this.#show([fallbackKey], () =>
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

  #showKey(messageKey: string, params?: TranslationParams): void {
    this.#show([messageKey], () =>
      this.#transloco.translate(messageKey, params)
    );
  }

  #show(keys: readonly (string | undefined)[], build: () => string): void {
    const order = ++this.#requested;
    const lang = this.#transloco.getActiveLang();
    const scopes = new Set(
      keys
        .map((key) => key?.split('.')[0])
        .filter((scope) => scope !== undefined && TRANSLATION_SCOPES.has(scope))
    );
    // A failed load still shows the message, with the key as its text.
    const loads = [lang, ...[...scopes].map((scope) => `${scope}/${lang}`)].map(
      (path) =>
        this.#transloco.load(path).pipe(
          take(1),
          catchError(() => of(null))
        )
    );

    forkJoin(loads).subscribe(() => {
      if (order < this.#opened) return;

      this.#opened = order;
      this.#snackBar.open(build(), this.#transloco.translate('common.close'));
    });
  }
}
