import { HttpRequest } from '@angular/common/http';
import { isAuthExcludedUrl } from './is-auth-excluded-urls';

describe('isAuthExcludedUrl', () => {
  it('should return true for login URL', () => {
    const request = new HttpRequest('POST', 'api/v1/auth/login', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return true for register URL', () => {
    const request = new HttpRequest('POST', 'api/v1/auth/register', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return true for refresh-token URL', () => {
    const request = new HttpRequest('POST', 'api/v1/auth/refresh-token', {});
    expect(isAuthExcludedUrl(request)).toBe(true);
  });

  it('should return false for profile URL', () => {
    const request = new HttpRequest('GET', 'api/v1/auth/profile');
    expect(isAuthExcludedUrl(request)).toBe(false);
  });

  it('should return false for logout URL', () => {
    const request = new HttpRequest('POST', 'api/v1/auth/logout', {});
    expect(isAuthExcludedUrl(request)).toBe(false);
  });

  it('should return false for unrelated URL', () => {
    const request = new HttpRequest('GET', 'api/v1/users');
    expect(isAuthExcludedUrl(request)).toBe(false);
  });
});
