import { HttpRequest } from '@angular/common/http';
import { isTokenRefreshExcludedUrl } from './is-token-refresh-excluded-urls';

describe('isTokenRefreshExcludedUrl', () => {
  it('should return true for logout URL', () => {
    const request = new HttpRequest('POST', 'api/v1/auth/logout', {});
    expect(isTokenRefreshExcludedUrl(request)).toBe(true);
  });

  it('should return false for login URL', () => {
    const request = new HttpRequest('POST', 'api/v1/auth/login', {});
    expect(isTokenRefreshExcludedUrl(request)).toBe(false);
  });

  it('should return false for profile URL', () => {
    const request = new HttpRequest('GET', 'api/v1/auth/profile');
    expect(isTokenRefreshExcludedUrl(request)).toBe(false);
  });

  it('should return false for unrelated URL', () => {
    const request = new HttpRequest('GET', 'api/v1/users');
    expect(isTokenRefreshExcludedUrl(request)).toBe(false);
  });
});
