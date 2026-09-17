/**
 * A password change on the profile revokes every session on the server, so the
 * profile page hands the user to `/login` with this marker instead of a
 * snackbar that would vanish with the page.
 */
export const PASSWORD_CHANGED_PARAM = 'password_changed';

export const PASSWORD_CHANGED = {
  /** Only the password changed. */
  Done: '1',
  /** The same submit also sent a confirmation link to a new address. */
  EmailPending: 'email-pending'
} as const;

export type PasswordChangedValue =
  (typeof PASSWORD_CHANGED)[keyof typeof PASSWORD_CHANGED];
