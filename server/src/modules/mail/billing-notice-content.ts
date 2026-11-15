import type { SupportedLocale } from '@app/shared/constants';
import type {
  NoticeAmount,
  UserNotificationContent,
  UserNotificationKind,
  UserNotificationPayloads
} from '@app/shared/types';
import { minorUnitScale } from '@app/shared/utils/money';
import type { EmailMessage } from './mail-content';

type NoticeText = Omit<EmailMessage, 'button'>;

/** One builder for each kind, so that a new kind does not compile without text. */
type NoticeBuilders = {
  [K in UserNotificationKind]: (
    payload: UserNotificationPayloads[K]
  ) => NoticeText;
};

const INTL_LOCALE: Record<SupportedLocale, string> = {
  en: 'en-GB',
  ru: 'ru-RU'
};

function money(
  locale: SupportedLocale,
  { amountMinor, currency }: NoticeAmount
) {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency
  }).format(amountMinor / 10 ** minorUnitScale(currency));
}

/**
 * A calendar day in UTC: the server does not know the time zone of the
 * reader, and every billing boundary is stored in UTC. The Russian form ends
 * in "г.", so a Russian text puts no period after it.
 */
function day(locale: SupportedLocale, iso: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(new Date(iso));
}

const en: NoticeBuilders = {
  invoice_paid: (payload) => ({
    subject: 'Payment received',
    heading: 'Payment received',
    paragraphs: [
      `We received your payment of ${money('en', payload)}.`,
      'The invoice is in the billing section of your account.'
    ]
  }),
  payment_failed: ({ planName, subscriptionStatus, nextAttemptAt }) => ({
    subject: 'Your payment failed',
    heading: 'Payment failed',
    paragraphs: [
      planName
        ? `We could not take the payment for the ${planName} plan.`
        : 'We could not take your payment.',
      subscriptionStatus === 'canceled'
        ? 'There are no more attempts, and the subscription is canceled.'
        : subscriptionStatus === 'past_due'
          ? nextAttemptAt
            ? `We will try again on ${day('en', nextAttemptAt)}. Make sure that your card can pay, or add another card.`
            : 'The payment provider will try again. Make sure that your card can pay.'
          : 'Check your card and try again.'
    ]
  }),
  subscription_cancel_scheduled: ({ planName, accessEndsAt }) => ({
    subject: 'Your subscription will end',
    heading: 'Subscription will end',
    paragraphs: [
      `Your ${planName} subscription will not renew. You keep access until ${day('en', accessEndsAt)}.`,
      'No more payments will be taken for it.'
    ]
  }),
  subscription_canceled: ({ planName }) => ({
    subject: 'Your subscription has ended',
    heading: 'Subscription ended',
    paragraphs: [
      `Your ${planName} subscription has ended, and its features are no longer available.`,
      'You can choose a plan again in the billing section of your account.'
    ]
  }),
  renewal_upcoming: ({ planName, renewsAt, ...amount }) => ({
    subject: 'Your subscription renews soon',
    heading: 'Subscription renews soon',
    paragraphs: [
      `Your ${planName} subscription renews on ${day('en', renewsAt)}. On that day we take ${money('en', amount)} from your saved card.`,
      'To stop the renewal, cancel the subscription in the billing section of your account before that day.'
    ]
  }),
  refund_issued: (payload) => ({
    subject: 'Refund issued',
    heading: 'Refund issued',
    paragraphs: [
      `We refunded ${money('en', payload)} to your payment method.`,
      'Your bank can take a few days to show the money.'
    ]
  }),
  credit_balance_depleted: () => ({
    subject: 'Your credit balance is empty',
    heading: 'No credits left',
    paragraphs: [
      'Your credit balance reached zero. Features that use credits stop until you buy more.'
    ]
  })
};

const ru: NoticeBuilders = {
  invoice_paid: (payload) => ({
    subject: 'Платёж получен',
    heading: 'Платёж получен',
    paragraphs: [
      `Мы получили ваш платёж на сумму ${money('ru', payload)}.`,
      'Счёт доступен в разделе оплаты вашего аккаунта.'
    ]
  }),
  payment_failed: ({ planName, subscriptionStatus, nextAttemptAt }) => ({
    subject: 'Платёж не прошёл',
    heading: 'Платёж не прошёл',
    paragraphs: [
      planName
        ? `Не удалось списать оплату за тариф ${planName}.`
        : 'Не удалось списать оплату.',
      subscriptionStatus === 'canceled'
        ? 'Попыток больше не будет, подписка отменена.'
        : subscriptionStatus === 'past_due'
          ? nextAttemptAt
            ? `Следующая попытка — ${day('ru', nextAttemptAt)} Проверьте, что с карты можно оплатить, или добавьте другую карту.`
            : 'Платёжная система повторит попытку. Проверьте, что с карты можно оплатить.'
          : 'Проверьте карту и повторите попытку.'
    ]
  }),
  subscription_cancel_scheduled: ({ planName, accessEndsAt }) => ({
    subject: 'Подписка будет завершена',
    heading: 'Подписка будет завершена',
    paragraphs: [
      `Подписка на тариф ${planName} не будет продлена. Доступ сохраняется до ${day('ru', accessEndsAt)}`,
      'Списаний по ней больше не будет.'
    ]
  }),
  subscription_canceled: ({ planName }) => ({
    subject: 'Подписка завершена',
    heading: 'Подписка завершена',
    paragraphs: [
      `Подписка на тариф ${planName} завершена, его возможности больше недоступны.`,
      'Выбрать тариф снова можно в разделе оплаты вашего аккаунта.'
    ]
  }),
  renewal_upcoming: ({ planName, renewsAt, ...amount }) => ({
    subject: 'Скоро продление подписки',
    heading: 'Скоро продление подписки',
    paragraphs: [
      `Подписка на тариф ${planName} продлится ${day('ru', renewsAt)}: в этот день с сохранённой карты будет списано ${money('ru', amount)}.`,
      'Чтобы подписка не продлилась, отмените её в разделе оплаты вашего аккаунта до этого дня.'
    ]
  }),
  refund_issued: (payload) => ({
    subject: 'Деньги возвращены',
    heading: 'Деньги возвращены',
    paragraphs: [
      `Мы вернули ${money('ru', payload)} на ваш способ оплаты.`,
      'Банку может понадобиться несколько дней, чтобы зачислить деньги.'
    ]
  }),
  credit_balance_depleted: () => ({
    subject: 'Баланс кредитов исчерпан',
    heading: 'Кредиты закончились',
    paragraphs: [
      'Баланс кредитов достиг нуля. Возможности, которые расходуют кредиты, недоступны, пока вы не пополните баланс.'
    ]
  })
};

const BUILDERS: Record<SupportedLocale, NoticeBuilders> = { en, ru };

const BUTTON_LABEL: Record<SupportedLocale, string> = {
  en: 'Open billing',
  ru: 'Открыть оплату'
};

function noticeText<K extends UserNotificationKind>(
  builders: NoticeBuilders,
  { kind, payload }: { kind: K; payload: UserNotificationPayloads[K] }
): NoticeText {
  return builders[kind](payload);
}

/** The mail of a stored billing notice, with a link to the billing page. */
export function billingNoticeMessage(
  locale: SupportedLocale,
  content: UserNotificationContent,
  billingUrl: string
): EmailMessage {
  return {
    ...noticeText(BUILDERS[locale], content),
    button: { url: billingUrl, label: BUTTON_LABEL[locale] }
  };
}
