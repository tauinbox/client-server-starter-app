import { DestroyRef, inject, Injectable, NgZone } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Subject } from 'rxjs';
import { SESSION_IDLE_TIMEOUT_MS } from '@app/shared/constants';

/** Shared by every tab, so input in one of them keeps all of them alive. */
export const LAST_ACTIVITY_KEY = 'auth_last_activity';

export const ACTIVITY_WRITE_INTERVAL_MS = 30 * 1000;
export const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart'
] as const;

/**
 * Ends an open tab's session after a period without user input. The refresh
 * loop reads no activity, so without this an unattended tab stays signed in
 * until the server's absolute session cap.
 */
@Injectable({ providedIn: 'root' })
export class IdleTimeoutService {
  readonly #document = inject(DOCUMENT);
  readonly #zone = inject(NgZone);
  readonly #timedOut = new Subject<void>();

  // AuthService owns the logout and injects this service, so the timeout is
  // announced rather than acted on here - the same shape as sessionCleared$.
  readonly timedOut$ = this.#timedOut.asObservable();

  #teardown: (() => void) | null = null;
  #lastWrite = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starting counts as activity: a sign-in or a page load is user input. */
  start(): void {
    this.#recordActivity(true);
    if (this.#teardown) return;

    const doc = this.#document;
    const win = doc.defaultView;
    if (!win) return;

    const onActivity = () => this.#recordActivity(false);
    // A hidden tab runs about one timer a minute and a frozen one runs none,
    // so the tab checks again the moment it is shown.
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'visible') this.#check();
    };
    const listenerOptions = { capture: true, passive: true };

    // Every keystroke lands here: inside the zone each one would start a
    // change detection pass for a write that renders nothing.
    this.#zone.runOutsideAngular(() => {
      for (const type of ACTIVITY_EVENTS) {
        doc.addEventListener(type, onActivity, listenerOptions);
      }
      doc.addEventListener('visibilitychange', onVisibilityChange);
      const intervalId = win.setInterval(
        () => this.#check(),
        IDLE_CHECK_INTERVAL_MS
      );

      this.#teardown = () => {
        for (const type of ACTIVITY_EVENTS) {
          doc.removeEventListener(type, onActivity, listenerOptions);
        }
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        win.clearInterval(intervalId);
      };
    });
  }

  stop(): void {
    if (!this.#teardown) return;
    this.#teardown();
    this.#teardown = null;
    this.#lastWrite = 0;
    this.#writeStored(null);
  }

  #recordActivity(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.#lastWrite < ACTIVITY_WRITE_INTERVAL_MS) return;
    this.#lastWrite = now;
    this.#writeStored(now);
  }

  /**
   * Compares timestamps instead of trusting a timer to fire on time: a
   * throttled or suspended tab wakes late, and the elapsed time is what counts.
   */
  #check(): void {
    // This tab's own write covers storage that is blocked or was cleared.
    const lastActivity = Math.max(this.#readStored(), this.#lastWrite);
    if (Date.now() - lastActivity < SESSION_IDLE_TIMEOUT_MS) return;

    this.stop();
    this.#zone.run(() => this.#timedOut.next());
  }

  // Storage can throw on access (blocked site data) and on a write (quota).
  // Neither may break the page: the tab falls back to its own timestamp.
  #readStored(): number {
    try {
      const value = Number(
        this.#document.defaultView?.localStorage.getItem(LAST_ACTIVITY_KEY)
      );
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  #writeStored(value: number | null): void {
    try {
      const storage = this.#document.defaultView?.localStorage;
      if (value === null) storage?.removeItem(LAST_ACTIVITY_KEY);
      else storage?.setItem(LAST_ACTIVITY_KEY, String(value));
    } catch {
      // Best effort, see #readStored.
    }
  }
}
