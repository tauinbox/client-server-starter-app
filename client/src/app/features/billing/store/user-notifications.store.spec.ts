import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import type { UserNotificationResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { UserNotificationsService } from '../services/user-notifications.service';
import { UnreadNoticesService } from '../services/unread-notices.service';
import { UserNotificationsStore } from './user-notifications.store';

const NOTICE: UserNotificationResponse = {
  id: 'notice-1',
  kind: 'invoice_paid',
  payload: { invoiceId: 'inv-1', amountMinor: 99000, currency: 'RUB' },
  createdAt: '2026-11-14T10:00:00.000Z',
  readAt: null
};

describe('UserNotificationsStore', () => {
  let markRead: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    markRead = vi.fn().mockReturnValue(of(undefined));
    refresh = vi.fn().mockResolvedValue(undefined);
    error = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        UserNotificationsStore,
        {
          provide: UserNotificationsService,
          useValue: {
            list: vi.fn().mockReturnValue(
              of({
                data: [NOTICE],
                meta: { nextCursor: null, hasMore: false }
              })
            ),
            markRead
          }
        },
        { provide: UnreadNoticesService, useValue: { refresh } },
        { provide: NotifyService, useValue: { error } }
      ]
    });
  });

  async function loaded() {
    const store = TestBed.inject(UserNotificationsStore);

    store.load();
    await vi.waitFor(() => expect(store.entities()).toHaveLength(1));

    return store;
  }

  it('marks the notice read on the page and reads the bell count again', async () => {
    const store = await loaded();

    await store.markRead('notice-1');

    expect(markRead).toHaveBeenCalledWith('notice-1');
    expect(store.entities()[0]?.readAt).toEqual(expect.any(String));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows one error and keeps the notice unread when the server refuses', async () => {
    const store = await loaded();
    const refusal = new HttpErrorResponse({ status: 404 });

    markRead.mockReturnValue(throwError(() => refusal));
    await store.markRead('notice-1');

    expect(error).toHaveBeenCalledWith(
      refusal,
      'billing.notifications.store.errorMarkReadFailed'
    );
    expect(store.entities()[0]?.readAt).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
