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

export type PasswordChangeSource = 'self' | 'admin' | 'reset';

/** Context carried by a credential-change notice. */
export interface CredentialChangeDetails {
  /** Preformatted UTC stamp, for example "2026-09-01 12:34 UTC". */
  when: string;
  ip?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
  vk: 'VK'
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

interface MessageBuilders {
  verification: (url: string) => EmailMessage;
  passwordReset: (url: string) => EmailMessage;
  emailChangeConfirm: (url: string) => EmailMessage;
  emailChangeNotifyOld: (maskedEmail: string) => EmailMessage;
  emailChangeCompleted: (newEmail: string) => EmailMessage;
  passwordChanged: (
    source: PasswordChangeSource,
    details: CredentialChangeDetails
  ) => EmailMessage;
  oauthLinked: (
    provider: string,
    details: CredentialChangeDetails
  ) => EmailMessage;
  oauthUnlinked: (
    provider: string,
    details: CredentialChangeDetails
  ) => EmailMessage;
  mfaEnabled: (details: CredentialChangeDetails) => EmailMessage;
  mfaDisabled: (details: CredentialChangeDetails) => EmailMessage;
}

/**
 * Notices below report a credential change that already happened. They carry no
 * action link on purpose: the recipient may be the victim of the change, and a
 * clickable control in a message that reaches an attacker-held mailbox is a new
 * credential-bearing surface. Recovery goes through the password reset flow.
 */
const EN_PASSWORD_SOURCE: Record<PasswordChangeSource, string> = {
  self: 'The password of your account was changed from the profile page.',
  admin: 'An administrator changed the password of your account.',
  reset: 'The password of your account was reset with a password-reset link.'
};

const RU_PASSWORD_SOURCE: Record<PasswordChangeSource, string> = {
  self: 'Пароль вашего аккаунта изменён на странице профиля.',
  admin: 'Администратор изменил пароль вашего аккаунта.',
  reset: 'Пароль вашего аккаунта сброшен по ссылке восстановления.'
};

const EN_RECOVERY =
  'If you did not make this change, reset your password immediately and review the connected accounts on your profile page.';

const RU_RECOVERY =
  'Если вы не выполняли это действие, немедленно сбросьте пароль и проверьте подключённые аккаунты на странице профиля.';

function enDetails({ when, ip }: CredentialChangeDetails): string {
  return ip ? `Time: ${when}. IP address: ${ip}.` : `Time: ${when}.`;
}

function ruDetails({ when, ip }: CredentialChangeDetails): string {
  return ip ? `Время: ${when}. IP-адрес: ${ip}.` : `Время: ${when}.`;
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
  }),
  passwordChanged: (source, details) => ({
    subject: 'Your password was changed',
    heading: 'Password changed',
    paragraphs: [
      EN_PASSWORD_SOURCE[source],
      enDetails(details),
      'All active sessions were signed out.',
      EN_RECOVERY
    ]
  }),
  oauthLinked: (provider, details) => ({
    subject: 'A sign-in provider was linked to your account',
    heading: 'Sign-in provider linked',
    paragraphs: [
      `${providerLabel(provider)} can now be used to sign in to your account.`,
      enDetails(details),
      EN_RECOVERY
    ]
  }),
  oauthUnlinked: (provider, details) => ({
    subject: 'A sign-in provider was removed from your account',
    heading: 'Sign-in provider removed',
    paragraphs: [
      `${providerLabel(provider)} can no longer be used to sign in to your account.`,
      enDetails(details),
      EN_RECOVERY
    ]
  }),
  mfaEnabled: (details) => ({
    subject: 'Two-factor authentication was turned on',
    heading: 'Two-factor authentication is on',
    paragraphs: [
      'Your account now asks for a code from your authenticator app after the password.',
      enDetails(details),
      'Keep your recovery codes somewhere safe. They are the only way in if you lose the device.',
      EN_RECOVERY
    ]
  }),
  mfaDisabled: (details) => ({
    subject: 'Two-factor authentication was turned off',
    heading: 'Two-factor authentication is off',
    paragraphs: [
      'Your account is now protected by its password alone.',
      enDetails(details),
      EN_RECOVERY
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
  }),
  passwordChanged: (source, details) => ({
    subject: 'Пароль вашего аккаунта изменён',
    heading: 'Пароль изменён',
    paragraphs: [
      RU_PASSWORD_SOURCE[source],
      ruDetails(details),
      'Все активные сеансы завершены.',
      RU_RECOVERY
    ]
  }),
  oauthLinked: (provider, details) => ({
    subject: 'К вашему аккаунту подключён способ входа',
    heading: 'Способ входа подключён',
    paragraphs: [
      `Теперь для входа в аккаунт можно использовать ${providerLabel(provider)}.`,
      ruDetails(details),
      RU_RECOVERY
    ]
  }),
  oauthUnlinked: (provider, details) => ({
    subject: 'От вашего аккаунта отключён способ входа',
    heading: 'Способ входа отключён',
    paragraphs: [
      `Использовать ${providerLabel(provider)} для входа в аккаунт больше нельзя.`,
      ruDetails(details),
      RU_RECOVERY
    ]
  }),
  mfaEnabled: (details) => ({
    subject: 'Включена двухфакторная аутентификация',
    heading: 'Двухфакторная аутентификация включена',
    paragraphs: [
      'Теперь после пароля аккаунт запрашивает код из приложения-аутентификатора.',
      ruDetails(details),
      'Сохраните резервные коды в надёжном месте. Это единственный способ войти, если вы потеряете устройство.',
      RU_RECOVERY
    ]
  }),
  mfaDisabled: (details) => ({
    subject: 'Отключена двухфакторная аутентификация',
    heading: 'Двухфакторная аутентификация отключена',
    paragraphs: [
      'Теперь аккаунт защищён только паролем.',
      ruDetails(details),
      RU_RECOVERY
    ]
  })
};

const BUILDERS: Record<SupportedLocale, MessageBuilders> = { en, ru };

export function mailMessages(locale: SupportedLocale): MessageBuilders {
  return BUILDERS[locale];
}
