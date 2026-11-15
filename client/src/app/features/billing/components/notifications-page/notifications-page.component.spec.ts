import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import type {
  UserNotificationContent,
  UserNotificationResponse
} from '@app/shared/types';
import { NotificationsService } from '@core/services/notifications.service';
import { LanguageService } from '@core/services/language.service';
import { NotifyService } from '@core/services/notify.service';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { UserNotificationsService } from '../../services/user-notifications.service';
import { UnreadNoticesService } from '../../services/unread-notices.service';
import ruBilling from '../../i18n/ru.json';
import { NotificationsPageComponent } from './notifications-page.component';

const AT = '2026-11-14T10:00:00.000Z';

let nextId = 0;

function notice(
  content: UserNotificationContent,
  readAt: string | null = null
): UserNotificationResponse {
  nextId++;

  return { ...content, id: `notice-${nextId}`, createdAt: AT, readAt };
}

const NOTICES: UserNotificationResponse[] = [
  notice({
    kind: 'invoice_paid',
    payload: { invoiceId: 'i', amountMinor: 1250, currency: 'USD' }
  }),
  notice({
    kind: 'payment_failed',
    payload: {
      subscriptionId: 's',
      planName: 'Pro',
      subscriptionStatus: 'past_due',
      nextAttemptAt: '2026-12-04T00:00:00.000Z'
    }
  }),
  notice({
    kind: 'payment_failed',
    payload: {
      subscriptionId: null,
      planName: null,
      subscriptionStatus: null,
      nextAttemptAt: null
    }
  }),
  notice({
    kind: 'subscription_cancel_scheduled',
    payload: {
      subscriptionId: 's',
      planName: 'Pro',
      accessEndsAt: '2026-12-01T00:00:00.000Z'
    }
  }),
  notice(
    {
      kind: 'subscription_canceled',
      payload: { subscriptionId: 's', planName: 'Pro' }
    },
    AT
  ),
  notice({
    kind: 'renewal_upcoming',
    payload: {
      subscriptionId: 's',
      planName: 'Pro',
      renewsAt: '2026-12-01T00:00:00.000Z',
      amountMinor: 2900,
      currency: 'USD'
    }
  }),
  notice({
    kind: 'refund_issued',
    payload: { invoiceId: 'i', amountMinor: 500, currency: 'USD' }
  }),
  notice({ kind: 'credit_balance_depleted', payload: {} })
];

describe('NotificationsPageComponent', () => {
  let created$: Subject<{ type: 'notification_created' }>;
  let list: ReturnType<typeof vi.fn>;
  let markRead: ReturnType<typeof vi.fn>;

  async function render() {
    const fixture = TestBed.createComponent(NotificationsPageComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  beforeEach(async () => {
    created$ = new Subject();
    list = vi
      .fn()
      .mockReturnValue(
        of({ data: NOTICES, meta: { nextCursor: null, hasMore: false } })
      );
    markRead = vi.fn().mockReturnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [NotificationsPageComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        { provide: UserNotificationsService, useValue: { list, markRead } },
        {
          provide: UnreadNoticesService,
          useValue: { refresh: vi.fn().mockResolvedValue(undefined) }
        },
        {
          provide: NotificationsService,
          useValue: {
            notificationCreated$: created$.asObservable(),
            reconnected$: new Subject<void>().asObservable()
          }
        },
        {
          provide: LanguageService,
          useValue: { language: signal('en').asReadonly() }
        },
        { provide: NotifyService, useValue: { error: vi.fn() } }
      ]
    }).compileComponents();
  });

  it('puts no period after a date in Russian, because the date ends in "г."', () => {
    const date = new Intl.DateTimeFormat('ru', {
      dateStyle: 'long',
      timeZone: 'UTC'
    }).format(new Date(AT));
    const texts = Object.values(ruBilling.notifications.kind).map((value) =>
      value.replace('{{date}}', date)
    );

    expect(date.endsWith('г.')).toBe(true);
    expect(texts.filter((value) => value.includes('г..'))).toEqual([]);
  });

  it('writes each kind of notice with its own values', async () => {
    const fixture = await render();
    const texts = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.notice-text'),
      (el) => el.textContent?.trim()
    );

    expect(texts).toEqual([
      'We received your payment of $12.50.',
      'The payment for the Pro plan failed. We will try again on December 4, 2026.',
      'A payment failed. Check your card and try again.',
      'Your Pro subscription will not renew. You keep access until December 1, 2026.',
      'Your Pro subscription has ended.',
      'Your Pro subscription renews on December 1, 2026. On that day we take $29.00 from your saved card. To stop the renewal, cancel the subscription before that day.',
      'We refunded $5.00 to your payment method.',
      'Your credit balance reached zero. Features that use credits stop until you buy more.'
    ]);
  });

  it('offers "mark as read" only on an unread notice and marks it', async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;
    const buttons =
      element.querySelectorAll<HTMLButtonElement>('.notice-action');

    expect(buttons).toHaveLength(NOTICES.length - 1);
    expect(
      element.querySelector('.notice:not(.unread) .notice-action')
    ).toBeNull();

    buttons[0]!.click();

    expect(markRead).toHaveBeenCalledWith(NOTICES[0]!.id);
  });

  it('reloads the first page when a new notice arrives', async () => {
    await render();
    list.mockClear();

    created$.next({ type: 'notification_created' });

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });
});
