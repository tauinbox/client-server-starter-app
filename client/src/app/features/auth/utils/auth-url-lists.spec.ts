import { HttpRequest } from '@angular/common/http';
import {
  AUTH_EXCLUDED_URLS,
  matchesAnyPath,
  TOKEN_REFRESH_EXCLUDED_URLS
} from './auth-url-lists';

describe('matchesAnyPath', () => {
  describe('with AUTH_EXCLUDED_URLS', () => {
    const matches = (request: HttpRequest<unknown>) =>
      matchesAnyPath(request, AUTH_EXCLUDED_URLS);

    it('should return true for login URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/login', {});
      expect(matches(request)).toBe(true);
    });

    it('should return true for register URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/register', {});
      expect(matches(request)).toBe(true);
    });

    it('should return true for refresh-token URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/refresh-token', {});
      expect(matches(request)).toBe(true);
    });

    // A 401 here says the code was wrong, not that the session expired. Routing
    // it into the refresh path swallowed the second attempt entirely.
    it('should return true for the two-factor verify URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/mfa/verify', {});
      expect(matches(request)).toBe(true);
    });

    it('should return true for the two-factor recovery URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/mfa/recovery', {});
      expect(matches(request)).toBe(true);
    });

    it('should return false for the two-factor setup URL', () => {
      // Enrolment happens inside a session, so a 401 there is a session verdict.
      const request = new HttpRequest('POST', '/api/v1/auth/mfa/setup', {});
      expect(matches(request)).toBe(false);
    });

    it('should return false for profile URL', () => {
      const request = new HttpRequest('GET', '/api/v1/auth/profile');
      expect(matches(request)).toBe(false);
    });

    it('should return false for logout URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/logout', {});
      expect(matches(request)).toBe(false);
    });

    it('should return false for unrelated URL', () => {
      const request = new HttpRequest('GET', '/api/v1/users');
      expect(matches(request)).toBe(false);
    });

    it('should return true for login URL with query params', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/login?lang=en', {});
      expect(matches(request)).toBe(true);
    });

    it('should return false for partial path match like login-history', () => {
      const request = new HttpRequest('GET', '/api/v1/auth/login-history');
      expect(matches(request)).toBe(false);
    });
  });

  describe('with TOKEN_REFRESH_EXCLUDED_URLS', () => {
    const matches = (request: HttpRequest<unknown>) =>
      matchesAnyPath(request, TOKEN_REFRESH_EXCLUDED_URLS);

    it('should return true for logout URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/logout', {});
      expect(matches(request)).toBe(true);
    });

    it('should return false for login URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/login', {});
      expect(matches(request)).toBe(false);
    });

    it('should return false for profile URL', () => {
      const request = new HttpRequest('GET', '/api/v1/auth/profile');
      expect(matches(request)).toBe(false);
    });

    it('should return false for unrelated URL', () => {
      const request = new HttpRequest('GET', '/api/v1/users');
      expect(matches(request)).toBe(false);
    });

    it('should return true for logout URL with query params', () => {
      const request = new HttpRequest(
        'POST',
        '/api/v1/auth/logout?all=true',
        {}
      );
      expect(matches(request)).toBe(true);
    });

    it('should return true for the two-factor enrolment URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/mfa/enable', {});
      expect(matches(request)).toBe(true);
    });

    it('should return false for the two-factor sign-in challenge URL', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/mfa/verify', {});
      expect(matches(request)).toBe(false);
    });

    it('should return false for partial path match like logout-all', () => {
      const request = new HttpRequest('POST', '/api/v1/auth/logout-all', {});
      expect(matches(request)).toBe(false);
    });
  });
});
