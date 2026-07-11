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
import { TokenService } from '@features/auth/services/token.service';
import type { NotificationEvent } from '@app/shared/types';

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
  let forceLogoutSpy: ReturnType<typeof vi.fn>;

  const isAuthenticatedSignal = signal(true);

  beforeEach(() => {
    forceLogoutSpy = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        NotificationsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: { isAuthenticated: isAuthenticatedSignal }
        },
        {
          provide: TokenService,
          useValue: { forceLogout: forceLogoutSpy }
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
    const received: Extract<
      NotificationEvent,
      { type: 'permissions_updated' }
    >[] = [];
    service.permissionsUpdated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk1 = 'data: {"type":"permissions_updated","userId":"u-2"}\n\n';
    req.event(makeProgressEvent(chunk1, chunk1.length));

    const chunk2 =
      chunk1 + 'data: {"type":"permissions_updated","userId":"u-3"}\n\n';
    req.event(makeProgressEvent(chunk2, chunk2.length));

    expect(received).toHaveLength(2);
    expect(received[0].userId).toBe('u-2');
    expect(received[1].userId).toBe('u-3');
  });

  it('should call tokenService.forceLogout() on session_invalidated event', () => {
    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk = 'data: {"type":"session_invalidated","userId":"u-4"}\n\n';
    req.event(makeProgressEvent(chunk, chunk.length));

    expect(forceLogoutSpy).toHaveBeenCalledTimes(1);
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

    service.sessionInvalidated$.subscribe((e) => session.push(e));
    service.permissionsUpdated$.subscribe((e) => permissions.push(e));
    service.userCrudEvents$.subscribe((e) => userCrud.push(e));
    service.featureFlagsUpdated$.subscribe((e) => featureFlags.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const chunk =
      'data: {"type":"session_invalidated","userId":"u-1"}\n\n' +
      'data: {"type":"permissions_updated","userId":"u-2"}\n\n' +
      'data: {"type":"user_crud_events","action":"created","userId":"u-3"}\n\n' +
      'data: {"type":"feature_flags_updated"}\n\n';
    req.event(makeProgressEvent(chunk, chunk.length));

    expect(session).toEqual([{ type: 'session_invalidated', userId: 'u-1' }]);
    expect(permissions).toEqual([
      { type: 'permissions_updated', userId: 'u-2' }
    ]);
    expect(userCrud).toEqual([
      { type: 'user_crud_events', action: 'created', userId: 'u-3' }
    ]);
    expect(featureFlags).toEqual([{ type: 'feature_flags_updated' }]);
  });

  it('emits an event exactly once when its SSE frame is split across two progress chunks', () => {
    const received: NotificationEvent[] = [];
    service.sessionInvalidated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const frame = 'data: {"type":"session_invalidated","userId":"u-9"}\n\n';
    const firstHalf = frame.slice(0, 25); // ends mid-JSON
    req.event(makeProgressEvent(firstHalf, firstHalf.length));
    expect(received).toHaveLength(0);

    req.event(makeProgressEvent(frame, frame.length));

    expect(received).toEqual([{ type: 'session_invalidated', userId: 'u-9' }]);
  });

  it('parses complete frames immediately while buffering an incomplete trailing frame', () => {
    const received: Extract<
      NotificationEvent,
      { type: 'permissions_updated' }
    >[] = [];
    service.permissionsUpdated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    const frameA = 'data: {"type":"permissions_updated","userId":"u-a"}\n\n';
    const frameB = 'data: {"type":"permissions_updated","userId":"u-b"}\n\n';
    const chunk1 = frameA + frameB.slice(0, 30);
    req.event(makeProgressEvent(chunk1, chunk1.length));

    expect(received).toHaveLength(1);
    expect(received[0].userId).toBe('u-a');

    const chunk2 = frameA + frameB;
    req.event(makeProgressEvent(chunk2, chunk2.length));

    expect(received).toHaveLength(2);
    expect(received[1].userId).toBe('u-b');
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

    // Advance past RECONNECT_DELAY_MS (5000)
    vi.advanceTimersByTime(5000);

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
