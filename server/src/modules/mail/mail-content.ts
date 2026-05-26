import { SupportedLocale } from '@app/shared/constants';

export const MAIL_APP_NAME = 'Nexus';

export interface EmailButton {
  url: string;
  label: string;
}

export interface EmailMessage {
  subject: string;
  heading: string;
  paragraphs: string[];
  button?: EmailButton;
}

/**
 * Footer line per locale, appended to every message by the layout.
 */
export const MAIL_FOOTER: Record<SupportedLocale, string> = {
  en: `This is an automated message from ${MAIL_APP_NAME}. Please do not reply to it.`,
  ru: `Это автоматическое сообщение от ${MAIL_APP_NAME}. Пожалуйста, не отвечайте на него.`
};

// Expiry windows below mirror the server constants:
//   verification — VERIFICATION_TOKEN_EXPIRY_MS (24h)
//   password reset — RESET_TOKEN_EXPIRY_MS (30 min)
//   email change — EMAIL_CHANGE_TOKEN_EXPIRY_MS (1h)

interface MessageBuilders {
  verification: (url: string) => EmailMessage;
  passwordReset: (url: string) => EmailMessage;
  emailChangeConfirm: (url: string) => EmailMessage;
  emailChangeNotifyOld: (maskedEmail: string) => EmailMessage;
  emailChangeCompleted: (newEmail: string) => EmailMessage;
}

const en: MessageBuilders = {
  verification: (url) => ({
    subject: 'Verify your email address',
    heading: 'Verify your email',
    paragraphs: [
      'Thanks for signing up. Please confirm your email address to activate your account.',
      "This link expires in 24 hours. If you didn't create an account, you can ignore this email."
    ],
    button: { url, label: 'Verify email' }
  }),
  passwordReset: (url) => ({
    subject: 'Reset your password',
    heading: 'Reset your password',
    paragraphs: [
      'We received a request to reset your password. Click the button below to choose a new one.',
      "This link expires in 30 minutes. If you didn't request a reset, you can safely ignore this email."
    ],
    button: { url, label: 'Reset password' }
  }),
  emailChangeConfirm: (url) => ({
    subject: 'Confirm your new email address',
    heading: 'Confirm your new email',
    paragraphs: [
      'You requested to change the email address on your account to this one. Confirm to complete the change.',
      "This link expires in 1 hour. Your account email won't change until you confirm. If you didn't request this, you can ignore this email."
    ],
    button: { url, label: 'Confirm new email' }
  }),
  emailChangeNotifyOld: (maskedEmail) => ({
    subject: 'Email change requested on your account',
    heading: 'Email change requested',
    paragraphs: [
      `Someone requested to change your account email to ${maskedEmail}.`,
      'If this was you, open the confirmation link sent to the new address — no action is needed here.',
      "If this wasn't you, change your password immediately and contact support. For your security, this message contains no action links."
    ]
  }),
  emailChangeCompleted: (newEmail) => ({
    subject: 'Your account email has been changed',
    heading: 'Email changed',
    paragraphs: [
      `Your account email has been changed to ${newEmail}.`,
      "If this wasn't you, contact support immediately."
    ]
  })
};

const ru: MessageBuilders = {
  verification: (url) => ({
    subject: 'Подтвердите адрес электронной почты',
    heading: 'Подтвердите вашу почту',
    paragraphs: [
      'Спасибо за регистрацию. Подтвердите адрес электронной почты, чтобы активировать аккаунт.',
      'Ссылка действует 24 часа. Если вы не создавали аккаунт, просто проигнорируйте это письмо.'
    ],
    button: { url, label: 'Подтвердить почту' }
  }),
  passwordReset: (url) => ({
    subject: 'Сброс пароля',
    heading: 'Сброс пароля',
    paragraphs: [
      'Мы получили запрос на сброс пароля. Нажмите кнопку ниже, чтобы задать новый пароль.',
      'Ссылка действует 30 минут. Если вы не запрашивали сброс, просто проигнорируйте это письмо.'
    ],
    button: { url, label: 'Сбросить пароль' }
  }),
  emailChangeConfirm: (url) => ({
    subject: 'Подтвердите новый адрес электронной почты',
    heading: 'Подтвердите новую почту',
    paragraphs: [
      'Вы запросили смену адреса электронной почты аккаунта на этот. Подтвердите, чтобы завершить смену.',
      'Ссылка действует 1 час. Адрес аккаунта не изменится, пока вы не подтвердите. Если вы этого не запрашивали, проигнорируйте письмо.'
    ],
    button: { url, label: 'Подтвердить новую почту' }
  }),
  emailChangeNotifyOld: (maskedEmail) => ({
    subject: 'Запрошена смена почты на вашем аккаунте',
    heading: 'Запрошена смена почты',
    paragraphs: [
      `Кто-то запросил смену почты вашего аккаунта на ${maskedEmail}.`,
      'Если это вы — откройте ссылку подтверждения, отправленную на новый адрес. Здесь никаких действий не требуется.',
      'Если это были не вы — немедленно смените пароль и свяжитесь с поддержкой. В целях безопасности это письмо не содержит ссылок-действий.'
    ]
  }),
  emailChangeCompleted: (newEmail) => ({
    subject: 'Адрес электронной почты аккаунта изменён',
    heading: 'Почта изменена',
    paragraphs: [
      `Адрес электронной почты вашего аккаунта изменён на ${newEmail}.`,
      'Если это были не вы — немедленно свяжитесь с поддержкой.'
    ]
  })
};

const BUILDERS: Record<SupportedLocale, MessageBuilders> = { en, ru };

export function mailMessages(locale: SupportedLocale): MessageBuilders {
  return BUILDERS[locale];
}
