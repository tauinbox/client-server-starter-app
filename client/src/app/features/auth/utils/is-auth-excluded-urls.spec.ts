import { HttpRequest } from '@angular/common/http';
import { isAuthExcludedUrl } from './is-auth-excluded-urls';

describe('isAuthExcludedUrl', () => {
  it('should return true for login URL', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/login', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return true for register URL', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/register', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return true for refresh-token URL', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/refresh-token', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  // A 401 here says the code was wrong, not that the session expired. Routing
  // it into the refresh path swallowed the second attempt entirely.
  it('should return true for the two-factor verify URL', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/mfa/verify', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return true for the two-factor recovery URL', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/mfa/recovery', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return false for the two-factor setup URL', () => {
    // Enrolment happens inside a session, so a 401 there is a session verdict.
    const request = new HttpRequest('POST', '/api/v1/auth/mfa/setup', {});
    expect(isAuthExcludedUrl(request)).toBe(false);
  });

  it('should return false for profile URL', () => {
    const request = new HttpRequest('GET', '/api/v1/auth/profile');
    expect(isAuthExcludedUrl(request)).toBe(false);
  });

  it('should return false for logout URL', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/logout', {});
    expect(isAuthExcludedUrl(request)).toBe(false);
  });

  it('should return false for unrelated URL', () => {
    const request = new HttpRequest('GET', '/api/v1/users');
    expect(isAuthExcludedUrl(request)).toBe(false);
  });

  it('should return true for login URL with query params', () => {
    const request = new HttpRequest('POST', '/api/v1/auth/login?lang=en', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return false for partial path match like login-history', () => {
    const request = new HttpRequest('GET', '/api/v1/auth/login-history');
    expect(isAuthExcludedUrl(request)).toBe(false);
  });
});
