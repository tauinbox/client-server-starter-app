import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import type { HttpDownloadProgressEvent } from '@angular/common/http';
import { filter, Subject } from 'rxjs';
import type { Observable, OperatorFunction, Subscription } from 'rxjs';
import type { NotificationEvent } from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { silentContext } from '@core/context-tokens/error-notifications';

const NOTIFICATIONS_STREAM_URL = '/api/v1/notifications/stream';
const INITIAL_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const RECYCLE_MIN_DELAY_MS = 4 * 60 * 60 * 1000;
const RECYCLE_JITTER_MS = 4 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly #http = inject(HttpClient);
  readonly #authStore = inject(AuthStore);

  readonly #events$ = new Subject<NotificationEvent>();
  readonly #reconnected$ = new Subject<void>();
  #subscription: Subscription | null = null;
  #recycleTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #wasLive = false;

  /**
   * A stream is live again after a gap. The server keeps no event history, so
   * an event sent during the gap is lost.
   */
  readonly reconnected$ = this.#reconnected$.asObservable();

  readonly sessionInvalidated$ = this.#events$.pipe(
    this.#ofType('session_invalidated')
  );

  readonly permissionsUpdated$ = this.#events$.pipe(
    this.#ofType('permissions_updated')
  );

  readonly userCrudEvents$ = this.#events$.pipe(
    this.#ofType('user_crud_events')
  );

  readonly userListStale$ = this.#events$.pipe(this.#ofType('user_list_stale'));

  readonly featureFlagsUpdated$ = this.#events$.pipe(
    this.#ofType('feature_flags_updated')
  );

  readonly entitlementsUpdated$ = this.#events$.pipe(
    this.#ofType('entitlements_updated')
  );

  connect(): void {
    if (this.#subscription) return;

    this.#clearReconnectTimer();
    this.#reconnectAttempt = 0;
    this.#wasLive = false;
    this.#open();
  }

  disconnect(): void {
    this.#clearRecycleTimer();
    this.#clearReconnectTimer();
    this.#subscription?.unsubscribe();
    this.#subscription = null;
  }

  #open(): void {
    let lastLength = 0;
    let pendingFrame = '';
    let live = false;

    this.#subscription = this.#http
      .get(NOTIFICATIONS_STREAM_URL, {
        observe: 'events',
        responseType: 'text',
        context: silentContext(),
        reportProgress: true
      })
      .subscribe({
        next: (event) => {
          if (
            event.type !== HttpEventType.DownloadProgress ||
            !this.#authStore.isAuthenticated()
          ) {
            return;
          }

          if (!live) {
            live = true;
            this.#onStreamLive();
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

  #onStreamLive(): void {
    this.#reconnectAttempt = 0;
    if (this.#wasLive) {
      this.#reconnected$.next();
    }
    this.#wasLive = true;
  }

  #handleStreamEnd(): void {
    this.#subscription = null;
    this.#clearRecycleTimer();
    this.#scheduleReconnect();
  }

  // A deploy ends every stream at the same moment. The jitter keeps the
  // clients from reconnecting, and retrying, at the same moments.
  #scheduleReconnect(): void {
    if (!this.#authStore.isAuthenticated()) return;

    this.#clearReconnectTimer();
    const delay =
      Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** this.#reconnectAttempt,
        MAX_RECONNECT_DELAY_MS
      ) *
      (0.5 + Math.random() / 2);
    this.#reconnectAttempt++;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#open();
    }, delay);
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

        this.#subscription.unsubscribe();
        this.#open();
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
      const json = dataLine.slice('data:'.length).trim();
      if (!json) continue;
      try {
        const event = JSON.parse(json) as NotificationEvent;
        this.#events$.next(event);
      } catch {
        // malformed SSE frame - skip
      }
    }
  }
}
