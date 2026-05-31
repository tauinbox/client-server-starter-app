import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpEventType } from '@angular/common/http';
import type { HttpDownloadProgressEvent } from '@angular/common/http';
import { filter, retry, Subject, tap, timer } from 'rxjs';
import type { Observable, OperatorFunction, Subscription } from 'rxjs';
import type { NotificationEvent } from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { TokenService } from '@features/auth/services/token.service';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';

const NOTIFICATIONS_STREAM_URL = '/api/v1/notifications/stream';
const MAX_RETRIES = 10;
const INITIAL_RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 60_000;
const RECONNECT_DELAY_MS = 5000;

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly #http = inject(HttpClient);
  readonly #authStore = inject(AuthStore);
  readonly #tokenService = inject(TokenService);

  readonly #events$ = new Subject<NotificationEvent>();
  #subscription: Subscription | null = null;

  readonly sessionInvalidated$ = this.#events$.pipe(
    this.#ofType('session_invalidated')
  );

  readonly permissionsUpdated$ = this.#events$.pipe(
    this.#ofType('permissions_updated')
  );

  readonly userCrudEvents$ = this.#events$.pipe(
    this.#ofType('user_crud_events')
  );

  readonly featureFlagsUpdated$ = this.#events$.pipe(
    this.#ofType('feature_flags_updated')
  );

  constructor() {
    // Subscribe once — service is a root singleton, no need to unsubscribe
    this.sessionInvalidated$.subscribe(() => {
      this.disconnect();
      this.#tokenService.forceLogout();
    });
  }

  connect(): void {
    if (this.#subscription) return;

    let lastLength = 0;

    this.#subscription = this.#http
      .get(NOTIFICATIONS_STREAM_URL, {
        observe: 'events',
        responseType: 'text',
        context: silentContext(),
        reportProgress: true
      })
      .pipe(
        tap({
          error: () => {
            lastLength = 0;
          }
        }),
        retry({
          count: MAX_RETRIES,
          delay: (_error, retryCount) =>
            timer(
              Math.min(
                INITIAL_RETRY_DELAY_MS * 2 ** (retryCount - 1),
                MAX_RETRY_DELAY_MS
              )
            ),
          resetOnSuccess: true
        })
      )
      .subscribe({
        next: (event) => {
          if (
            event.type !== HttpEventType.DownloadProgress ||
            !this.#authStore.isAuthenticated()
          ) {
            return;
          }

          const progressEvent = event as HttpDownloadProgressEvent;
          const text = progressEvent.partialText ?? '';
          const newContent = text.slice(lastLength);
          lastLength = text.length;

          this.#parseAndEmit(newContent);
        },
        error: () => {
          this.#subscription = null;
          this.#scheduleReconnect();
        },
        complete: () => {
          this.#subscription = null;
          this.#scheduleReconnect();
        }
      });
  }

  disconnect(): void {
    this.#subscription?.unsubscribe();
    this.#subscription = null;
  }

  #scheduleReconnect(): void {
    if (this.#authStore.isAuthenticated()) {
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    }
  }

  #ofType<T extends NotificationEvent['type']>(
    type: T
  ): OperatorFunction<
    NotificationEvent,
    Extract<NotificationEvent, { type: T }>
  > {
    return (source: Observable<NotificationEvent>) =>
      source.pipe(
        filter(
          (e): e is Extract<NotificationEvent, { type: T }> => e.type === type
        )
      );
  }

  #parseAndEmit(chunk: string): void {
    const blocks = chunk.split('\n\n');
    for (const block of blocks) {
      const dataLine = block
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const json = dataLine.slice('data:'.length).trim();
        const event = JSON.parse(json) as NotificationEvent;
        this.#events$.next(event);
      } catch {
        // malformed SSE frame — skip
      }
    }
  }
}
