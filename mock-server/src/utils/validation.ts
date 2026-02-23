const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function validateMaxLength(
  value: string,
  max: number,
  field: string
): string | null {
  if (value.length > max) {
    return `${field} must be shorter than or equal to ${max} characters`;
  }
  return null;
}

export function validateMinLength(
  value: string,
  min: number,
  field: string
): string | null {
  if (value.length < min) {
    return `${field} must be longer than or equal to ${min} characters`;
  }
  return null;
}
