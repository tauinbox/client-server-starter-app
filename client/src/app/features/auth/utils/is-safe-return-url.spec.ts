import { isSafeReturnUrl } from './is-safe-return-url';

describe('isSafeReturnUrl', () => {
  it('should accept app-internal paths', () => {
    expect(isSafeReturnUrl('/')).toBe(true);
    expect(isSafeReturnUrl('/admin/users')).toBe(true);
    expect(isSafeReturnUrl('/users?page=2#top')).toBe(true);
  });

  it('should reject protocol-relative and absolute URLs', () => {
    expect(isSafeReturnUrl('//evil.example')).toBe(false);
    expect(isSafeReturnUrl('https://evil.example')).toBe(false);
    expect(isSafeReturnUrl('/redirect?next=//evil.example')).toBe(false);
  });

  it('should reject relative paths and non-strings', () => {
    expect(isSafeReturnUrl('admin')).toBe(false);
    expect(isSafeReturnUrl('')).toBe(false);
    expect(isSafeReturnUrl(undefined)).toBe(false);
    expect(isSafeReturnUrl(null)).toBe(false);
    expect(isSafeReturnUrl(42)).toBe(false);
  });
});
