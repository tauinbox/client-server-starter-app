import { TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpEventType } from '@angular/common/http';
import type { HttpDownloadProgressEvent } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { NotificationsService } from './notifications.service';
import { AuthStore } from '@features/auth/store/auth.store';
import type { NotificationEvent } from '@app/shared/types';

const RECYCLE_MIN_DELAY_MS = 4 * 60 * 60 * 1000;
const RECYCLE_MAX_DELAY_MS = 8 * 60 * 60 * 1000;

function makeProgressEvent(
  partialText: string,
  loaded: number
): HttpDownloadProgressEvent {
  return {
    type: HttpEventType.DownloadProgress,
    loaded,
    partialText
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let httpController: HttpTestingController;

  const isAuthenticatedSignal = signal(true);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NotificationsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: { isAuthenticated: isAuthenticatedSignal }
        }
      ]
    });

    service = TestBed.inject(NotificationsService);
    httpController = TestBed.inject(HttpTestingController);
    isAuthenticatedSignal.set(true);
  });

  afterEach(() => {
    service.disconnect();
    httpController.verify();
    // Nine tests below install fake timers inline; the builder runs files with
    // `isolate: false`, so one failing mid-test would fake timers for every
    // later file in the same worker.
    vi.useRealTimers();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('connect() should make a GET request to the SSE stream URL', () => {
    service.connect();

    const req = httpController.expectOne('/api/v1/notifications/stream');
    expect(req.request.method).toBe('GET');
    expect(req.request.reportProgress).toBe(true);
    req.flush('');
  });

  it('connect() should not open a second connection if already connected', () => {
    service.connect();
    service.connect();

    httpController.expectOne('/api/v1/notifications/stream').flush('');
  });

  it('disconnect() should cancel the pending request', () => {
    service.connect();

    const req = httpController.expectOne('/api/v1/notifications/stream');
    service.disconnect();

    expect(req.cancelled).toBe(true);
  });

  it('should parse an SSE chunk and emit the NotificationEvent', () => {
    const received: NotificationEvent[] = [];
    service.userCrudEvents$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk =
      'data: {"type":"user_crud_events","action":"created","userId":"u-1"}\n\n';
    req.event(makeProgressEvent(chunk, chunk.length));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: 'user_crud_events',
      action: 'created',
      userId: 'u-1'
    });
  });

  it('should only process new content on subsequent chunks', () => {
    const received: NotificationEvent[] = [];
    service.userCrudEvents$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk1 =
      'data: {"type":"user_crud_events","action":"created","userId":"u-2"}\n\n';
    req.event(makeProgressEvent(chunk1, chunk1.length));

    const chunk2 =
      chunk1 +
      'data: {"type":"user_crud_events","action":"created","userId":"u-3"}\n\n';
    req.event(makeProgressEvent(chunk2, chunk2.length));

    expect(received).toEqual([
      { type: 'user_crud_events', action: 'created', userId: 'u-2' },
      { type: 'user_crud_events', action: 'created', userId: 'u-3' }
    ]);
  });

  it('emits on featureFlagsUpdated$ when a feature_flags_updated event arrives', () => {
    const received: Extract<
      NotificationEvent,
      { type: 'feature_flags_updated' }
    >[] = [];
    service.featureFlagsUpdated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk = 'data: {"type":"feature_flags_updated"}\n\n';
    req.event(makeProgressEvent(chunk, chunk.length));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'feature_flags_updated' });
  });

  it('routes a mixed stream so each typed stream only forwards its own type', () => {
    const session: NotificationEvent[] = [];
    const permissions: NotificationEvent[] = [];
    const userCrud: NotificationEvent[] = [];
    const featureFlags: NotificationEvent[] = [];
    const listStale: NotificationEvent[] = [];

    service.sessionInvalidated$.subscribe((e) => session.push(e));
    service.permissionsUpdated$.subscribe((e) => permissions.push(e));
    service.userCrudEvents$.subscribe((e) => userCrud.push(e));
    service.featureFlagsUpdated$.subscribe((e) => featureFlags.push(e));
    service.userListStale$.subscribe((e) => listStale.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk =
      'data: {"type":"session_invalidated"}\n\n' +
      'data: {"type":"permissions_updated"}\n\n' +
      'data: {"type":"user_crud_events","action":"created","userId":"u-3"}\n\n' +
      'data: {"type":"feature_flags_updated"}\n\n' +
      'data: {"type":"user_list_stale"}\n\n';
    req.event(makeProgressEvent(chunk, chunk.length));

    expect(session).toEqual([{ type: 'session_invalidated' }]);
    expect(permissions).toEqual([{ type: 'permissions_updated' }]);
    expect(userCrud).toEqual([
      { type: 'user_crud_events', action: 'created', userId: 'u-3' }
    ]);
    expect(featureFlags).toEqual([{ type: 'feature_flags_updated' }]);
    expect(listStale).toEqual([{ type: 'user_list_stale' }]);
  });

  it('emits an event exactly once when its SSE frame is split across two progress chunks', () => {
    const received: NotificationEvent[] = [];
    service.sessionInvalidated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const frame = 'data: {"type":"session_invalidated"}\n\n';
    const firstHalf = frame.slice(0, 25); // ends mid-JSON
    req.event(makeProgressEvent(firstHalf, firstHalf.length));
    expect(received).toHaveLength(0);

    req.event(makeProgressEvent(frame, frame.length));

    expect(received).toEqual([{ type: 'session_invalidated' }]);
  });

  it('parses complete frames immediately while buffering an incomplete trailing frame', () => {
    const received: NotificationEvent[] = [];
    service.userCrudEvents$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const frameA =
      'data: {"type":"user_crud_events","action":"created","userId":"u-a"}\n\n';
    const frameB =
      'data: {"type":"user_crud_events","action":"created","userId":"u-b"}\n\n';
    const chunk1 = frameA + frameB.slice(0, 30);
    req.event(makeProgressEvent(chunk1, chunk1.length));

    expect(received).toEqual([
      { type: 'user_crud_events', action: 'created', userId: 'u-a' }
    ]);

    const chunk2 = frameA + frameB;
    req.event(makeProgressEvent(chunk2, chunk2.length));

    expect(received).toEqual([
      { type: 'user_crud_events', action: 'created', userId: 'u-a' },
      { type: 'user_crud_events', action: 'created', userId: 'u-b' }
    ]);
  });

  it('does not emit anything for a chunk with no complete frame', () => {
    const received: NotificationEvent[] = [];
    service.userCrudEvents$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const partial = 'data: {"type":"user_crud_events","action":"cre';
    req.event(makeProgressEvent(partial, partial.length));

    expect(received).toHaveLength(0);
  });

  it('should skip malformed SSE frames without throwing', () => {
    const received: NotificationEvent[] = [];
    service.sessionInvalidated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    req.event(makeProgressEvent('data: {invalid json}\n\n', 20));

    expect(received).toHaveLength(0);
  });

  it('should skip heartbeat frames (empty data)', () => {
    const received: NotificationEvent[] = [];
    service.userCrudEvents$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    req.event(makeProgressEvent('data: \n\n', 8));

    expect(received).toHaveLength(0);
  });

  it('should schedule reconnect when server closes the connection', () => {
    vi.useFakeTimers();

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    // Server closes the connection (complete)
    req.flush('');

    // The first reconnect waits at most 3 s
    vi.advanceTimersByTime(3000);

    // A new connection should have been attempted
    httpController.expectOne('/api/v1/notifications/stream').flush('');

    vi.useRealTimers();
  });

  it('should not reconnect after explicit disconnect()', () => {
    vi.useFakeTimers();

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');
    service.disconnect();
    expect(req.cancelled).toBe(true);

    vi.advanceTimersByTime(10_000);

    httpController.expectNone('/api/v1/notifications/stream');

    vi.useRealTimers();
  });

  it('should not reconnect after disconnect() when a reconnect is already pending', () => {
    vi.useFakeTimers();

    service.connect();
    // Server closes the connection, which schedules a reconnect
    httpController.expectOne('/api/v1/notifications/stream').flush('');

    service.disconnect();
    vi.advanceTimersByTime(10_000);

    httpController.expectNone('/api/v1/notifications/stream');

    vi.useRealTimers();
  });

  it('should reopen the stream once the recycle interval elapses', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    service.connect();
    const first = httpController.expectOne('/api/v1/notifications/stream');

    vi.advanceTimersByTime(RECYCLE_MIN_DELAY_MS);

    expect(first.cancelled).toBe(true);
    const second = httpController.expectOne('/api/v1/notifications/stream');
    expect(second.cancelled).toBe(false);

    // The recycled connection schedules the next recycle in turn
    vi.advanceTimersByTime(RECYCLE_MIN_DELAY_MS);
    expect(second.cancelled).toBe(true);
    httpController.expectOne('/api/v1/notifications/stream');

    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it('should still emit events received on the recycled connection', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const received: NotificationEvent[] = [];
    service.userCrudEvents$.subscribe((e) => received.push(e));

    service.connect();
    httpController.expectOne('/api/v1/notifications/stream');

    vi.advanceTimersByTime(RECYCLE_MIN_DELAY_MS);

    const recycled = httpController.expectOne('/api/v1/notifications/stream');
    const chunk =
      'data: {"type":"user_crud_events","action":"deleted","userId":"u-7"}\n\n';
    recycled.event(makeProgressEvent(chunk, chunk.length));

    expect(received).toEqual([
      { type: 'user_crud_events', action: 'deleted', userId: 'u-7' }
    ]);

    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it('should not recycle after an explicit disconnect()', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    service.connect();
    httpController.expectOne('/api/v1/notifications/stream');
    service.disconnect();

    vi.advanceTimersByTime(RECYCLE_MAX_DELAY_MS);

    httpController.expectNone('/api/v1/notifications/stream');

    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it('should not recycle while the user is not authenticated', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    isAuthenticatedSignal.set(false);
    vi.advanceTimersByTime(RECYCLE_MAX_DELAY_MS);

    expect(req.cancelled).toBe(false);
    httpController.expectNone('/api/v1/notifications/stream');

    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it('should drop the recycle timer of a connection the server has closed', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    service.connect();
    httpController.expectOne('/api/v1/notifications/stream').flush('');

    vi.advanceTimersByTime(5000);
    httpController.expectOne('/api/v1/notifications/stream');

    // Only the reconnected stream owns a recycle timer, so this window must
    // produce exactly one new connection, not one per stale timer
    vi.advanceTimersByTime(RECYCLE_MIN_DELAY_MS);
    httpController.expectOne('/api/v1/notifications/stream');

    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  describe('reconnect delay', () => {
    const STREAM = '/api/v1/notifications/stream';
    let randomSpy: { mockRestore: () => void };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      randomSpy.mockRestore();
    });

    const expectReconnectAfter = (delayMs: number) => {
      vi.advanceTimersByTime(delayMs - 1);
      httpController.expectNone(STREAM);
      vi.advanceTimersByTime(1);
      return httpController.expectOne(STREAM);
    };

    it('doubles while the stream fails and resets after a first frame', () => {
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
      service.connect();

      httpController.expectOne(STREAM).flush('');
      expectReconnectAfter(3000).flush('');
      expectReconnectAfter(6000).flush('');
      const live = expectReconnectAfter(12_000);

      live.event(makeProgressEvent('data: \n\n', 8));
      live.flush('');

      expectReconnectAfter(3000).flush('');
      expectReconnectAfter(6000);
    });

    it('stops growing at 60 s', () => {
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
      service.connect();

      httpController.expectOne(STREAM).flush('');
      for (const delay of [3000, 6000, 12_000, 24_000, 48_000, 60_000]) {
        expectReconnectAfter(delay).flush('');
      }
      expectReconnectAfter(60_000);
    });

    it('waits at least half of the delay', () => {
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      service.connect();

      httpController.expectOne(STREAM).flush('');
      expectReconnectAfter(1500).flush('');
      expectReconnectAfter(3000);
    });
  });

  describe('reconnected$', () => {
    const STREAM = '/api/v1/notifications/stream';
    const heartbeat = makeProgressEvent('data: \n\n', 8);
    let reconnects: number;

    beforeEach(() => {
      reconnects = 0;
      service.reconnected$.subscribe(() => reconnects++);
    });

    it('does not emit for the first stream of a connect()', () => {
      service.connect();
      httpController.expectOne(STREAM).event(heartbeat);

      expect(reconnects).toBe(0);
    });

    it('emits once when a reopened stream sends its first frame', () => {
      vi.useFakeTimers();
      service.connect();
      const first = httpController.expectOne(STREAM);
      first.event(heartbeat);
      first.flush('');

      vi.advanceTimersByTime(3000);
      const second = httpController.expectOne(STREAM);
      expect(reconnects).toBe(0);

      second.event(heartbeat);
      second.event(makeProgressEvent('data: \n\ndata: \n\n', 16));

      expect(reconnects).toBe(1);
    });

    it('emits when the recycled stream sends its first frame', () => {
      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      service.connect();
      httpController.expectOne(STREAM).event(heartbeat);

      vi.advanceTimersByTime(RECYCLE_MIN_DELAY_MS);
      httpController.expectOne(STREAM).event(heartbeat);

      expect(reconnects).toBe(1);
      randomSpy.mockRestore();
    });

    it('does not emit for a new connect() after disconnect()', () => {
      service.connect();
      httpController.expectOne(STREAM).event(heartbeat);
      service.disconnect();

      service.connect();
      httpController.expectOne(STREAM).event(heartbeat);

      expect(reconnects).toBe(0);
    });
  });

  it('should not reconnect if user is not authenticated', () => {
    vi.useFakeTimers();

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    isAuthenticatedSignal.set(false);
    req.flush('');

    vi.advanceTimersByTime(10_000);

    httpController.expectNone('/api/v1/notifications/stream');

    vi.useRealTimers();
  });
});
