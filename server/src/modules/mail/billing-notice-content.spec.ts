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
  { kind: 'credit_balance_depleted', payload: {} }
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
