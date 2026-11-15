import type { UserNotificationContent } from '@app/shared/types';
import { billingNoticeMessage } from './billing-notice-content';

const URL = 'https://app.example.com/billing/settings';

const ALL_KINDS: UserNotificationContent[] = [
  {
    kind: 'invoice_paid',
    payload: { invoiceId: 'inv-1', amountMinor: 99000, currency: 'RUB' }
  },
  {
    kind: 'payment_failed',
    payload: {
      subscriptionId: 'sub-1',
      planName: 'Pro',
      subscriptionStatus: 'past_due',
      nextAttemptAt: '2026-12-04T00:00:00.000Z'
    }
  },
  {
    kind: 'subscription_cancel_scheduled',
    payload: {
      subscriptionId: 'sub-1',
      planName: 'Pro',
      accessEndsAt: '2026-12-01T00:00:00.000Z'
    }
  },
  {
    kind: 'subscription_canceled',
    payload: { subscriptionId: 'sub-1', planName: 'Pro' }
  },
  {
    kind: 'refund_issued',
    payload: { invoiceId: 'inv-1', amountMinor: 1250, currency: 'USD' }
  },
  { kind: 'credit_balance_depleted', payload: {} },
  {
    kind: 'renewal_upcoming',
    payload: {
      subscriptionId: 'sub-1',
      planName: 'Pro',
      renewsAt: '2026-12-01T00:00:00.000Z',
      amountMinor: 99000,
      currency: 'RUB'
    }
  }
];

function text(content: UserNotificationContent, locale: 'en' | 'ru') {
  return billingNoticeMessage(locale, content, URL).paragraphs.join(' ');
}

describe('billingNoticeMessage', () => {
  it.each(['en', 'ru'] as const)(
    'gives every kind a subject, a heading, a text and the billing link in %s',
    (locale) => {
      for (const content of ALL_KINDS) {
        const message = billingNoticeMessage(locale, content, URL);

        expect(message.subject).not.toBe('');
        expect(message.heading).not.toBe('');
        expect(message.paragraphs.length).toBeGreaterThan(0);
        expect(message.button?.url).toBe(URL);
      }
    }
  );

  it('formats the amount in the currency of the invoice', () => {
    const [paid, , , , refund] = ALL_KINDS;

    expect(text(paid, 'en')).toContain('RUB 990.00');
    expect(text(refund, 'en')).toContain('US$12.50');
    expect(text(paid, 'ru')).toMatch(/990,00\s₽/u);
  });

  it('gives the last day of a scheduled cancel as a UTC calendar day', () => {
    const [, , scheduled] = ALL_KINDS;

    expect(text(scheduled, 'en')).toContain('until 1 December 2026');
    expect(text(scheduled, 'ru')).toContain('до 1 декабря 2026');
  });

  it('puts no second period after a Russian date, which ends in "г."', () => {
    const texts = ALL_KINDS.map((content) => text(content, 'ru'));

    expect(texts.filter((t) => t.includes('г..'))).toEqual([]);
    expect(text(ALL_KINDS[1], 'ru')).toContain(
      'Следующая попытка — 4 декабря 2026 г. Проверьте'
    );
    expect(text(ALL_KINDS[2], 'ru')).toContain(
      'Доступ сохраняется до 1 декабря 2026 г. Списаний'
    );
  });

  it('gives the day and the amount of a renewal charge, and how to stop it', () => {
    const renewal = ALL_KINDS.at(-1)!;

    expect(text(renewal, 'en')).toMatch(
      /^Your Pro subscription renews on 1 December 2026\. On that day we take RUB\s990\.00 from your saved card\. To stop the renewal, cancel the subscription in the billing section of your account before that day\.$/u
    );
    expect(text(renewal, 'ru')).toMatch(
      /^Подписка на тариф Pro продлится 1 декабря 2026 г\.: в этот день с сохранённой карты будет списано 990,00\s₽\. /u
    );
  });

  it.each([
    [
      'a retry date',
      {
        subscriptionStatus: 'past_due',
        nextAttemptAt: '2026-12-04T00:00:00.000Z'
      },
      'We will try again on 4 December 2026'
    ],
    [
      'a retry of the provider',
      { subscriptionStatus: 'past_due', nextAttemptAt: null },
      'The payment provider will try again'
    ],
    [
      'the end of the attempts',
      { subscriptionStatus: 'canceled', nextAttemptAt: null },
      'There are no more attempts'
    ],
    [
      'a failed first payment',
      { subscriptionStatus: 'incomplete', nextAttemptAt: null },
      'Check your card and try again'
    ]
  ] as const)('tells %s after a failed payment', (_name, state, expected) => {
    const content: UserNotificationContent = {
      kind: 'payment_failed',
      payload: { subscriptionId: 'sub-1', planName: 'Pro', ...state }
    };

    expect(text(content, 'en')).toContain(expected);
  });
});
