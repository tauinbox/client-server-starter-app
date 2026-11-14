import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import type { UserNotificationUnreadCountResponse } from '@app/shared/types';
import { NotificationsService } from '@core/services/notifications.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { UnreadNoticesService } from './unread-notices.service';
import { UserNotificationsService } from './user-notifications.service';

describe('UnreadNoticesService', () => {
  const authenticated = signal(true);
  const billingEnabled = signal(true);
  let created$: Subject<{ type: 'notification_created' }>;
  let reconnected$: Subject<void>;
  let unreadCount: ReturnType<
    typeof vi.fn<() => Observable<UserNotificationUnreadCountResponse>>
  >;

  function setup(): UnreadNoticesService {
    const service = TestBed.inject(UnreadNoticesService);

    TestBed.tick();

    return service;
  }

  beforeEach(() => {
    authenticated.set(true);
    billingEnabled.set(true);
    created$ = new Subject();
    reconnected$ = new Subject();
    unreadCount = vi.fn(() => of({ unread: 3 }));
    TestBed.configureTestingModule({
      providers: [
        { provide: UserNotificationsService, useValue: { unreadCount } },
        {
          provide: AuthStore,
          useValue: { isAuthenticated: authenticated.asReadonly() }
        },
        {
          provide: FeatureFlagsStore,
          useValue: { isEnabled: () => billingEnabled.asReadonly() }
        },
        {
          provide: NotificationsService,
          useValue: {
            notificationCreated$: created$.asObservable(),
            reconnected$: reconnected$.asObservable()
          }
        }
      ]
    });
  });

  it('reads the count when a signed-in user has billing', async () => {
    const service = setup();

    await vi.waitFor(() => expect(service.unread()).toBe(3));
    expect(service.available()).toBe(true);
  });

  it.each([
    ['no user is signed in', () => authenticated.set(false)],
    ['billing is off', () => billingEnabled.set(false)]
  ])('shows no bell and reads nothing when %s', (_name, change) => {
    change();
    const service = setup();

    expect(service.available()).toBe(false);
    expect(service.unread()).toBe(0);
    expect(unreadCount).not.toHaveBeenCalled();
  });

  it('drops the count of the last user on sign-out', async () => {
    const service = setup();

    await vi.waitFor(() => expect(service.unread()).toBe(3));
    authenticated.set(false);
    TestBed.tick();

    expect(service.unread()).toBe(0);
  });

  it('reads the count again on a new notice and after a gap in the stream', async () => {
    const service = setup();

    await vi.waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(1));
    unreadCount.mockReturnValue(of({ unread: 4 }));
    created$.next({ type: 'notification_created' });
    await vi.waitFor(() => expect(service.unread()).toBe(4));

    unreadCount.mockReturnValue(of({ unread: 5 }));
    reconnected$.next();
    await vi.waitFor(() => expect(service.unread()).toBe(5));
  });

  it('lets no older answer replace a newer one', async () => {
    const slow = new Subject<UserNotificationUnreadCountResponse>();

    unreadCount.mockReturnValueOnce(slow);
    const service = setup();

    unreadCount.mockReturnValue(of({ unread: 7 }));
    await service.refresh();
    slow.next({ unread: 1 });
    slow.complete();
    await Promise.resolve();

    expect(service.unread()).toBe(7);
  });

  it('keeps the last count when a read fails', async () => {
    const service = setup();

    await vi.waitFor(() => expect(service.unread()).toBe(3));
    unreadCount.mockReturnValue(throwError(() => new Error('offline')));
    await service.refresh();

    expect(service.unread()).toBe(3);
  });
});
