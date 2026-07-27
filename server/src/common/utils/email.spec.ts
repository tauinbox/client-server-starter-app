import { normalizeEmail } from '@app/shared/utils/email';

describe('normalizeEmail', () => {
  it('lowercases and trims a string address', () => {
    expect(normalizeEmail('  John@GMAIL.com \n')).toBe('john@gmail.com');
  });

  it('leaves an already canonical address untouched', () => {
    expect(normalizeEmail('john@gmail.com')).toBe('john@gmail.com');
  });

  it('returns null for every non-string value', () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail({ $ne: null })).toBeNull();
    expect(normalizeEmail(['a@b.c'])).toBeNull();
  });

  it('preserves the empty string rather than collapsing it to null', () => {
    expect(normalizeEmail('   ')).toBe('');
  });
});
