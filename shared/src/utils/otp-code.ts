/**
 * Users read codes off a screen and type them back with spaces, dashes and
 * whatever case the app showed. Only the characters carry meaning. The server
 * and the mock server both compare codes in this form.
 */
export function normalizeOtpCode(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}
