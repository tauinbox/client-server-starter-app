import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SESSION_IDLE_TIMEOUT_MS } from '@app/shared/constants';
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  IDLE_CHECK_INTERVAL_MS,
  IdleTimeoutService,
  LAST_ACTIVITY_KEY
} from './idle-timeout.service';

describe('IdleTimeoutService', () => {
  let service: IdleTimeoutService;
  let timedOut: Mock<() => void>;

  const stored = () => localStorage.getItem(LAST_ACTIVITY_KEY);
  const press = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(IdleTimeoutService);
    timedOut = vi.fn<() => void>();
    service.timedOut$.subscribe(timedOut);
  });

  afterEach(() => {
    service.stop();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('records the start as activity', () => {
    service.start();

    expect(stored()).toBe(String(Date.now()));
  });

  it('writes input to storage at most once per write interval', () => {
    service.start();
    const startedAt = Date.now();

    vi.advanceTimersByTime(ACTIVITY_WRITE_INTERVAL_MS - 1);
    press();
    expect(stored()).toBe(String(startedAt));

    vi.advanceTimersByTime(1);
    press();
    expect(stored()).toBe(String(Date.now()));
  });

  it('times out once the idle limit has passed without input', () => {
    service.start();

    vi.advanceTimersByTime(SESSION_IDLE_TIMEOUT_MS - IDLE_CHECK_INTERVAL_MS);
    expect(timedOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS);
    expect(timedOut).toHaveBeenCalledTimes(1);
  });

  it('stays alive while input keeps arriving', () => {
    service.start();

    for (let minute = 0; minute < 45; minute++) {
      vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS);
      press();
    }

    expect(timedOut).not.toHaveBeenCalled();
  });

  it('counts input that another tab wrote to storage', () => {
    service.start();

    vi.advanceTimersByTime(20 * 60 * 1000);
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(timedOut).not.toHaveBeenCalled();
  });

  it('checks at once when a tab that slept past the limit is shown', () => {
    service.start();

    // A suspended tab: the clock moves and no timer fires.
    vi.setSystemTime(Date.now() + SESSION_IDLE_TIMEOUT_MS + 1000);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(timedOut).toHaveBeenCalledTimes(1);
  });

  it('falls back to its own timestamp when storage was cleared', () => {
    service.start();

    vi.advanceTimersByTime(10 * 60 * 1000);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timedOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timedOut).toHaveBeenCalledTimes(1);
  });

  it('fires once and then stops listening', () => {
    service.start();

    vi.advanceTimersByTime(SESSION_IDLE_TIMEOUT_MS * 3);

    expect(timedOut).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
  });

  it('stop removes the listeners, the timer and the stored timestamp', () => {
    service.start();
    service.stop();

    expect(stored()).toBeNull();
    press();
    expect(stored()).toBeNull();

    vi.advanceTimersByTime(SESSION_IDLE_TIMEOUT_MS * 2);
    expect(timedOut).not.toHaveBeenCalled();
  });

  it('a second start while running resets the activity and adds no timer', () => {
    service.start();
    vi.advanceTimersByTime(20 * 60 * 1000);
    service.start();

    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(timedOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timedOut).toHaveBeenCalledTimes(1);
  });
});
