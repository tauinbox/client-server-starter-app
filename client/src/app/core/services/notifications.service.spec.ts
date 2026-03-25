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
    const received: NotificationEvent[] = [];
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

  it('should skip malformed SSE frames without throwing', () => {
    const received: NotificationEvent[] = [];
    service.sessionInvalidated$.subscribe((e) => received.push(e));

    service.connect();
    const req = httpController.expectOne('/api/v1/notifications/stream');

    req.event(makeProgressEvent('data: {invalid json}\n\n', 20));

    expect(received).toHaveLength(0);
  });
});
