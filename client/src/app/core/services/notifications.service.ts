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
const RECYCLE_MIN_DELAY_MS = 4 * 60 * 60 * 1000;
const RECYCLE_JITTER_MS = 4 * 60 * 60 * 1000;

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly #http = inject(HttpClient);
  readonly #authStore = inject(AuthStore);
  readonly #tokenService = inject(TokenService);

  readonly #events$ = new Subject<NotificationEvent>();
  #subscription: Subscription | null = null;
  #recycleTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
    let pendingFrame = '';

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
            pendingFrame = '';
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
          pendingFrame += text.slice(lastLength);
          lastLength = text.length;

          // A progress chunk can end mid-frame (TCP boundary); parse only
          // frames terminated by \n\n and keep the incomplete tail buffered
          // until the next chunk completes it
          const boundary = pendingFrame.lastIndexOf('\n\n');
          if (boundary === -1) return;

          const completeFrames = pendingFrame.slice(0, boundary);
          pendingFrame = pendingFrame.slice(boundary + 2);

          this.#parseAndEmit(completeFrames);
        },
        error: () => this.#handleStreamEnd(),
        complete: () => this.#handleStreamEnd()
      });

    this.#scheduleRecycle();
  }

  disconnect(): void {
    this.#clearRecycleTimer();
    this.#clearReconnectTimer();
    this.#subscription?.unsubscribe();
    this.#subscription = null;
  }

  #handleStreamEnd(): void {
    this.#subscription = null;
    this.#clearRecycleTimer();
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (!this.#authStore.isAuthenticated()) return;

    this.#clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  // Angular's HTTP backends retain the whole response body for the life of a
  // request (every raw chunk plus a cumulative partialText), so a stream that
  // never ends grows forever. Reopening it periodically drops those buffers.
  // The jitter keeps clients from reconnecting in lockstep.
  #scheduleRecycle(): void {
    this.#clearRecycleTimer();
    this.#recycleTimer = setTimeout(
      () => {
        this.#recycleTimer = null;
        if (!this.#subscription || !this.#authStore.isAuthenticated()) return;

        this.disconnect();
        this.connect();
      },
      RECYCLE_MIN_DELAY_MS + Math.random() * RECYCLE_JITTER_MS
    );
  }

  #clearRecycleTimer(): void {
    if (this.#recycleTimer === null) return;

    clearTimeout(this.#recycleTimer);
    this.#recycleTimer = null;
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer === null) return;

    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
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
